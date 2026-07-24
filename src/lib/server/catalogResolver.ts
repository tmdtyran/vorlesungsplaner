// Resolves the full lecture_catalog for one semester+language by re-parsing
// each leaf node's stored raw_title HTML with the CURRENT catalogParser.ts
// logic, instead of trusting whatever got persisted to the DB back when the
// (network-heavy) catalogue import last ran. This means a parser bugfix
// takes effect the moment the process restarts/the cache is invalidated —
// no need to re-import the whole catalog just because of a small parsing
// tweak.
//
// The result is cached in memory per periodeId+lang (no TTL) so normal
// browsing/semester-switching stays fast — it's only actually recomputed
// once per semester+language combo per process lifetime, or right after an
// import invalidates it (see lecturesCache.ts, which now also clears this
// cache alongside the API-response cache it already managed).

import { getDb } from "./db";
import { parseLeafTitle, stripHtml, type ParsedLeafTitle } from "./importer/catalogParser";
import { parseLectureDetails } from "./importer/parser";

export interface TimeSlot {
    frequency: string;
    weekday: string;
    start: string;
    end: string;
}

export interface ResolvedCatalogEntry {
    id: number;
    hierarchy_key: number | null;
    unibas_id: number | null;
    course_number: string | null;
    title: string;
    type_label: string | null;
    credits: number | null;
    lecturer: string | null;
    parent_key: number | null;
    node_type: string | null;
    depth: number;
    schedule: string | null;
    timeSlots: TimeSlot[];
}

interface RawRow {
    id: number;
    hierarchy_key: number | null;
    parent_key: number | null;
    depth: number;
    node_type: string | null;
    title: string | null;
    raw_title: string | null;
    is_leaf: number;
}

const cache = new Map<string, ResolvedCatalogEntry[]>();

function keyFor(periodeId: string, lang: string): string {
    return `${periodeId}:${lang}`;
}

export function invalidateResolvedCatalog(periodeId: string, lang: string) {
    cache.delete(keyFor(periodeId, lang));
}

function scheduleText(slots: TimeSlot[]): string | null {
    if (slots.length === 0) return null;
    const unique = [...new Set(slots.map(s => `${s.frequency} ${s.weekday} ${s.start}-${s.end}`.trim()))];
    return unique.join(' | ');
}

export function getResolvedCatalog(periodeId: string, lang: string): ResolvedCatalogEntry[] {
    const key = keyFor(periodeId, lang);
    const cached = cache.get(key);
    if (cached) return cached;

    const db = getDb(periodeId, lang);
    const rows = db.prepare(`
        SELECT id, hierarchy_key, parent_key, depth, node_type, title, raw_title, is_leaf
        FROM lecture_catalog ORDER BY hierarchy_key
    `).all() as RawRow[];

    // Enrichment fallback: some catalogue tree titles don't embed a weekly
    // slot at all even though the lecture's own detail page clearly has one
    // (e.g. certain title formats parseLeafTitle doesn't expect). When that
    // happens, fall back to the recurring-pattern table already stored on
    // the detail page (lecture_details.raw_html from "Import All Lectures").
    // Cached per unibas_id for this resolve pass only, since several catalog
    // rows (cross-listings) can share the same unibas_id.
    const detailSlotsCache = new Map<number, TimeSlot[]>();
    function getDetailTimeSlots(unibasId: number): TimeSlot[] {
        const existing = detailSlotsCache.get(unibasId);
        if (existing) return existing;

        let slots: TimeSlot[] = [];
        try {
            const detailRow = db.prepare(
                `SELECT raw_html FROM lecture_details WHERE unibas_id = ?`
            ).get(unibasId) as { raw_html: string | null } | undefined;

            if (detailRow?.raw_html) {
                const parsed = parseLectureDetails(detailRow.raw_html, unibasId);
                for (const p of parsed.recurringPattern) {
                    const m = p.time.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
                    if (!m) continue;
                    slots.push({
                        frequency: p.frequency,
                        weekday: p.weekday,
                        start: `${m[1].padStart(2, '0')}:${m[2]}`,
                        end: `${m[3].padStart(2, '0')}:${m[4]}`
                    });
                }
            }
        } catch {
            // Best-effort enrichment only — never let this break the catalog resolve.
        }
        detailSlotsCache.set(unibasId, slots);
        return slots;
    }

    function baseEntry(row: RawRow, overrides: Partial<ResolvedCatalogEntry> = {}): ResolvedCatalogEntry {
        return {
            id: row.id,
            hierarchy_key: row.hierarchy_key,
            unibas_id: null,
            course_number: null,
            title: row.title ?? '',
            type_label: null,
            credits: null,
            lecturer: null,
            parent_key: row.parent_key,
            node_type: row.node_type,
            depth: row.depth,
            schedule: null,
            timeSlots: [],
            ...overrides
        };
    }

    const resolved: ResolvedCatalogEntry[] = rows.map(row => {
        if (!row.is_leaf || !row.raw_title) {
            // Folder/group node — plain, non-fragile text. Nothing to re-parse.
            return baseEntry(row);
        }

        let parsed: ParsedLeafTitle | null;
        try {
            parsed = parseLeafTitle(row.raw_title);
        } catch {
            parsed = null;
        }

        if (!parsed) {
            return baseEntry(row, { title: row.title ?? stripHtml(row.raw_title) });
        }

        let timeSlots = parsed.timeSlots;
        if (timeSlots.length === 0 && parsed.unibasId) {
            timeSlots = getDetailTimeSlots(parsed.unibasId);
        }

        return baseEntry(row, {
            unibas_id: parsed.unibasId,
            course_number: parsed.courseNumber,
            title: parsed.name,
            type_label: parsed.typeLabel,
            credits: parsed.credits,
            lecturer: parsed.lecturer,
            node_type: row.node_type ?? (parsed.unibasId ? "lecture" : "group"),
            schedule: scheduleText(timeSlots),
            timeSlots
        });
    });

    cache.set(key, resolved);
    return resolved;
}
