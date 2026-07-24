import { getDb } from "./db";
import { parseFullLectureDetails } from "./importer/parser";
import { getResolvedCatalog, type ResolvedCatalogEntry } from "./catalogResolver";

export interface CatalogLecture {
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
}

export interface RecurringTime {
    frequency: string | null;
    weekday: string;
    start_time: string;
    end_time: string;
}

export interface LectureDetail {
    id: number;
    unibas_id: number;
    course_number: string | null;
    title: string;
    language: string | null;
    semester: string | null;
    offered_by: string | null;
    faculty: string | null;
    lecturers: string | null;
    assessment_format: string | null;
    assessment_details: string | null;
    content: string | null;
    imported_at: string | null;
    events: LectureDetailEvent[];
    recurringTimes: RecurringTime[];
    modules: string[];
}

export interface LectureDetailEvent {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
}

function toCatalogLecture(entry: ResolvedCatalogEntry): CatalogLecture {
    return {
        id: entry.id,
        hierarchy_key: entry.hierarchy_key,
        unibas_id: entry.unibas_id,
        course_number: entry.course_number,
        title: entry.title,
        type_label: entry.type_label,
        credits: entry.credits,
        lecturer: entry.lecturer,
        parent_key: entry.parent_key,
        node_type: entry.node_type,
        depth: entry.depth,
        schedule: entry.schedule
    };
}

export function getAllLectures(periodeId: string, lang: string): CatalogLecture[] {
    const catalog = getResolvedCatalog(periodeId, lang);

    // A lecture can be cross-listed under multiple faculties/programs and thus
    // appear at several hierarchy positions with the same unibas_id. The flat
    // "all lectures" list should show each real lecture only once (the
    // lowest-id placement) — folders/groups (unibas_id === null) are left
    // untouched since flat mode filters those out client-side anyway.
    const bestByUnibasId = new Map<number, ResolvedCatalogEntry>();
    const groupsAndFolders: ResolvedCatalogEntry[] = [];
    for (const entry of catalog) {
        if (entry.unibas_id === null) {
            groupsAndFolders.push(entry);
            continue;
        }
        const existing = bestByUnibasId.get(entry.unibas_id);
        if (!existing || entry.id < existing.id) bestByUnibasId.set(entry.unibas_id, entry);
    }

    const result = [...groupsAndFolders, ...bestByUnibasId.values()].map(toCatalogLecture);
    result.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return result;
}

export function getLecturesHierarchy(periodeId: string, lang: string): CatalogLecture[] {
    // getResolvedCatalog already reads rows ORDER BY hierarchy_key.
    return getResolvedCatalog(periodeId, lang).map(toCatalogLecture);
}

export function getCatalogEntryByUnibasId(unibasId: number, periodeId: string, lang: string): CatalogLecture | null {
    const matches = getResolvedCatalog(periodeId, lang).filter(e => e.unibas_id === unibasId);
    if (matches.length === 0) return null;
    const entry = matches.reduce((a, b) => (a.id <= b.id ? a : b));
    return toCatalogLecture(entry);
}

// Public-facing lookup by course number (e.g. "65935-01"), the identifier
// shown before every lecture title in listings — used by the Details tab
// search field instead of the internal unibas_id.
export function getCatalogEntryByCourseNumber(courseNumber: string, periodeId: string, lang: string): CatalogLecture | null {
    const matches = getResolvedCatalog(periodeId, lang)
        .filter(e => e.unibas_id !== null && e.course_number === courseNumber);
    if (matches.length === 0) return null;
    const entry = matches.reduce((a, b) => (a.id <= b.id ? a : b));
    return toCatalogLecture(entry);
}

// A lecture can be cross-listed under multiple hierarchy branches. For each
// placement, walk up parent_key to find ancestor nodes whose title marks a
// "Modul" (module) grouping — these are the modules the lecture can be
// assigned to. Uses a recursive CTE starting from every placement row.
function getModulesForLecture(db: ReturnType<typeof getDb>, unibasId: number): string[] {
    const rows = db.prepare(`
        WITH RECURSIVE ancestors(id, hierarchy_key, parent_key, title) AS (
            SELECT id, hierarchy_key, parent_key, title
            FROM lecture_catalog WHERE unibas_id = ?
            UNION ALL
            SELECT lc.id, lc.hierarchy_key, lc.parent_key, lc.title
            FROM lecture_catalog lc
            JOIN ancestors a ON lc.hierarchy_key = a.parent_key
        )
        SELECT DISTINCT title FROM ancestors
        WHERE title LIKE 'Modul:%' OR title LIKE 'Module:%'
        ORDER BY title
    `).all(unibasId) as { title: string }[];

    return rows.map(r => r.title.replace(/^Modul(e)?:\s*/i, "").trim());
}

function getRecurringTimesForLecture(periodeId: string, lang: string, unibasId: number): RecurringTime[] {
    const seen = new Set<string>();
    const times: RecurringTime[] = [];
    for (const entry of getResolvedCatalog(periodeId, lang)) {
        if (entry.unibas_id !== unibasId) continue;
        for (const slot of entry.timeSlots) {
            const key = `${slot.frequency}|${slot.weekday}|${slot.start}|${slot.end}`;
            if (seen.has(key)) continue;
            seen.add(key);
            times.push({ frequency: slot.frequency || null, weekday: slot.weekday, start_time: slot.start, end_time: slot.end });
        }
    }
    times.sort((a, b) => a.weekday.localeCompare(b.weekday) || a.start_time.localeCompare(b.start_time));
    return times;
}

export function getLectureDetail(unibasId: number, periodeId: string, lang: string): LectureDetail | null {
    const db = getDb(periodeId, lang);
    const detail = db.prepare(`
        SELECT id, unibas_id, course_number, title,
            language, semester, offered_by, faculty,
            lecturers, assessment_format, assessment_details, content, imported_at
        FROM lecture_details WHERE unibas_id = ?
    `).get(unibasId) as Omit<LectureDetail, 'events' | 'recurringTimes' | 'modules'> | undefined;

    // Primary source: parse the "Module" field directly out of the stored
    // detail page HTML — same logic the Details tab uses. This is more
    // reliable than walking the catalog hierarchy for a "Modul:"-titled
    // ancestor, since some lectures (e.g. doctoral courses) sit under
    // folders like "Doktorat X: Empfehlungen" with no such ancestor at all,
    // even though the detail page itself does list real modules.
    let modules: string[] = [];
    const rawHtml = detail ? getLectureRawHtml(unibasId, periodeId, lang) : null;
    if (rawHtml) {
        modules = parseFullLectureDetails(rawHtml, unibasId).modules;
    }
    if (modules.length === 0) {
        modules = getModulesForLecture(db, unibasId);
    }

    const recurringTimes = getRecurringTimesForLecture(periodeId, lang, unibasId);

    if (!detail) {
        // No lecture_details row yet (details not imported), but we can
        // still surface modules/recurring times derived from the catalog.
        const catalogEntry = getCatalogEntryByUnibasId(unibasId, periodeId, lang);
        if (!catalogEntry) return null;
        return {
            id: catalogEntry.id,
            unibas_id: unibasId,
            course_number: catalogEntry.course_number,
            title: catalogEntry.title,
            language: null,
            semester: null,
            offered_by: null,
            faculty: null,
            lecturers: catalogEntry.lecturer,
            assessment_format: null,
            assessment_details: null,
            content: null,
            imported_at: null,
            events: [],
            recurringTimes,
            modules
        };
    }

    const events = db.prepare(`
        SELECT id, date, start_time, end_time, room
        FROM lecture_detail_events
        WHERE lecture_detail_id = ?
        ORDER BY date, start_time
    `).all(detail.id) as LectureDetailEvent[];

    return { ...detail, events, recurringTimes, modules };
}

// Raw HTML for a lecture, stored during "Import All Lectures" — used to
// re-parse the full 5-section detail view (Details tab) on demand, without
// needing another network fetch.
export function getLectureRawHtml(unibasId: number, periodeId: string, lang: string): string | null {
    const db = getDb(periodeId, lang);
    const row = db.prepare(`
        SELECT raw_html FROM lecture_details WHERE unibas_id = ?
    `).get(unibasId) as { raw_html: string | null } | undefined;
    return row?.raw_html ?? null;
}
