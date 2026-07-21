/**
 * importCatalog.ts
 * Fetches the full lecture tree from UniBasel for a given semester and language.
 * Language is determined server-side via session cookie — we first visit the
 * language-specific page to get that cookie, then use it for all tree API calls.
 *
 * Usage:
 *   bun scripts/importCatalog.ts --periodeId=2025004 --lang=de
 */

import { getDb } from "../src/lib/server/db";

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith("--"))
        .map(a => { const [k, v] = a.slice(2).split("="); return [k, v]; })
);
const periodeId = args.periodeId ?? "2025004";
const lang      = args.lang ?? "de";
const LANG_PAGE = lang === "de" ? "de/semesterprogramm" : "en/semester-program";
const BASE      = "https://vorlesungsverzeichnis.unibas.ch";

console.log(`Importing catalogue: periodeId=${periodeId}, lang=${lang}`);
console.log(`Database: data/${periodeId}_${lang}.db`);

// --- Step 1: visit the language page to get a session cookie ---
console.log(`Establishing ${lang} session via ${BASE}/${LANG_PAGE}...`);
const sessionRes = await fetch(`${BASE}/${LANG_PAGE}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
});
// Collect all Set-Cookie headers
const rawCookies = sessionRes.headers.getSetCookie?.() ?? [];
// Also handle older environments where getSetCookie isn't available
const cookieHeader = rawCookies.length > 0
    ? rawCookies.map(c => c.split(";")[0]).join("; ")
    : (sessionRes.headers.get("set-cookie") ?? "").split(",").map(c => c.trim().split(";")[0]).join("; ");

console.log(`Session cookies: ${cookieHeader || "(none — server may use IP/Referer only)"}`);

// --- DB setup ---
const db = getDb(periodeId, lang);
db.exec(`BEGIN TRANSACTION`);
db.exec(`DELETE FROM lecture_times`);
db.exec(`DELETE FROM lecture_catalog`);
console.log("Cleared existing catalog.");

interface TreeNode {
    key: string;
    title: string;
    lazy?: boolean;
    data?: {
        unibasId?: number;
        credits?: number | string;
        lecturer?: string;
        courseNumber?: string;
        weekday?: string;
        startTime?: string;
        endTime?: string;
        frequency?: string;
        [key: string]: any;
    };
    children?: TreeNode[];
}

const insertNode = db.prepare(`
    INSERT INTO lecture_catalog
        (hierarchy_key, unibas_id, course_number, title, type_label, credits, lecturer, parent_key, node_type, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hierarchy_key) DO UPDATE SET
        unibas_id=excluded.unibas_id, course_number=excluded.course_number,
        title=excluded.title, type_label=excluded.type_label,
        credits=excluded.credits, lecturer=excluded.lecturer,
        parent_key=excluded.parent_key, node_type=excluded.node_type, depth=excluded.depth
`);

const insertTime = db.prepare(`
    INSERT INTO lecture_times (lecture_catalog_id, frequency, weekday, start_time, end_time)
    SELECT id, ?, ?, ?, ? FROM lecture_catalog WHERE hierarchy_key = ?
`);

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url: string, attempt = 1): Promise<any> {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": lang === "de" ? "de-CH,de;q=0.9" : "en-US,en;q=0.9",
                "Referer": `${BASE}/${LANG_PAGE}`,
                ...(cookieHeader ? { "Cookie": cookieHeader } : {})
            }
        });
        if (res.status === 429) {
            console.log(`  Rate limited, waiting ${attempt * 600}ms...`);
            await sleep(attempt * 600);
            return fetchJson(url, attempt + 1);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.json();
    } catch (err) {
        if (attempt < 6) {
            await sleep(attempt * 1000);
            return fetchJson(url, attempt + 1);
        }
        throw err;
    }
}

let count = 0;

// Folder/group node titles also carry embedded HTML — strip tags and
// decode entities for clean display.
function stripHtml(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// UniBasel tree nodes carry no structured `data` object for lecture nodes —
// course number, credits, unibas ID, lecturer and schedule are all embedded
// as raw HTML inside `node.title`. We parse that string here.
function parseLeafTitle(raw: string): {
    courseNumber: string;
    typeLabel: string;
    name: string;
    credits: number;
    unibasId: number | null;
    lecturer: string | null;
    timeSlots: { frequency: string; weekday: string; start: string; end: string }[];
} | null {
    const decoded = raw
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const headerMatch = decoded.match(
        /^([\d]{2,6}-\d{2,3})\s*-\s*([^:]+):\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*KP\)/
    );
    if (!headerMatch) return null;

    const courseNumber = headerMatch[1].trim();
    const typeLabel = headerMatch[2].trim();
    const name = headerMatch[3].trim();
    const credits = parseFloat(headerMatch[4].replace(',', '.'));

    const idMatch =
        decoded.match(/data-watchlist="(\d+)"/) ??
        decoded.match(/\?id=(\d+)/);
    const unibasId = idMatch ? parseInt(idMatch[1]) : null;

    const spanMatches = [...decoded.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)];
    let lecturer: string | null = null;
    const timeSlots: { frequency: string; weekday: string; start: string; end: string }[] = [];

    for (const sp of spanMatches) {
        // When there is no lecturer, the source markup still emits a leading
        // "- " before the schedule (e.g. "- wöchentlich: Montag 16.15-20.00").
        // Strip that bare dash so it isn't mistaken for a "Lecturer - Schedule" separator.
        const text = sp[1].replace(/\s+/g, ' ').trim().replace(/^-\s+/, '');
        const dashIdx = text.indexOf(' - ');
        let lecturerPart = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : text;
        let schedulePart = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : '';

        // No " - " separator found: this is either just a lecturer name, or —
        // when there is no lecturer at all — a schedule string of the form
        // "<Frequency>: <Weekday> HH.MM-HH.MM". Detect the latter so it isn't
        // stored as the lecturer.
        if (!schedulePart) {
            const freqOnlyMatch = lecturerPart.match(/^([^:]+):\s*(.+)$/);
            if (freqOnlyMatch && /\d{2}[.:]\d{2}/.test(freqOnlyMatch[2])) {
                schedulePart = lecturerPart;
                lecturerPart = '';
            }
        }

        if (!lecturer && lecturerPart) lecturer = lecturerPart;

        if (schedulePart) {
            const freqMatch = schedulePart.match(/^([^:]+):\s*(.*)$/);
            const frequency = freqMatch ? freqMatch[1].trim() : '';
            const rest = freqMatch ? freqMatch[2] : schedulePart;

            const timeRegex = /([A-ZÄÖÜ][a-zäöüß]+)\s+(\d{2}[.:]\d{2})\s*-\s*(\d{2}[.:]\d{2})/g;
            let m: RegExpExecArray | null;
            while ((m = timeRegex.exec(rest)) !== null) {
                timeSlots.push({
                    frequency,
                    weekday: m[1],
                    start: m[2].replace('.', ':'),
                    end: m[3].replace('.', ':')
                });
            }
        }
    }

    // Some titles carry the same lecturer/schedule <span> twice (e.g.
    // duplicate markup for responsive layouts) — dedupe identical slots.
    const seenSlots = new Set<string>();
    const uniqueTimeSlots = timeSlots.filter(t => {
        const key = `${t.frequency}|${t.weekday}|${t.start}|${t.end}`;
        if (seenSlots.has(key)) return false;
        seenSlots.add(key);
        return true;
    });

    return { courseNumber, typeLabel, name, credits, unibasId, lecturer, timeSlots: uniqueTimeSlots };
}

let insertErrors = 0;

async function processNodes(nodes: TreeNode[], parentKey: string | null, depth: number) {
    for (const node of nodes) {
        const hk = parseInt(node.key);
        if (isNaN(hk)) continue;

        const isLeaf = !node.lazy && !node.children?.length;
        const parsed = isLeaf ? parseLeafTitle(node.title) : null;

        const unibasId = parsed?.unibasId ?? null;
        const credits = parsed?.credits ?? null;
        const lecturer = parsed?.lecturer ?? null;
        const courseNumber = parsed?.courseNumber ?? null;
        const typeLabel = parsed?.typeLabel ?? null;
        const cleanTitle = parsed?.name ?? stripHtml(node.title);
        const nodeType = node.lazy ? "folder" : (unibasId ? "lecture" : "group");

        // A single bad insert must never abort processing of sibling nodes
        // or their subtrees — wrap defensively.
        try {
            insertNode.run(
                hk, unibasId, courseNumber, cleanTitle, typeLabel,
                credits, lecturer,
                parentKey ? parseInt(parentKey) : null,
                nodeType, depth
            );

            if (unibasId && parsed) {
                for (const slot of parsed.timeSlots) {
                    insertTime.run(slot.frequency, slot.weekday, slot.start, slot.end, hk);
                }
            }
        } catch (err) {
            insertErrors++;
            console.error(`  Insert failed for node ${hk} ("${cleanTitle}"): ${err}`);
        }

        count++;
        if (count % 50 === 0) console.log(`  ${count} nodes...`);

        if (node.lazy) {
            await sleep(100);
            try {
                const url = `${BASE}/components/hierarchie.cfc?method=getSubTree&parentid=${node.key}&level=${depth + 1}&period=${periodeId}&hid=`;
                const children = await fetchJson(url);
                if (children?.length) await processNodes(children, node.key, depth + 1);
            } catch (err) {
                console.error(`  Failed subtree-fetch ${node.key}: ${err}`);
            }
        } else if (node.children?.length) {
            await processNodes(node.children, node.key, depth + 1);
        }
    }
}

console.log("Fetching root tree...");
const rootUrl = `${BASE}/components/hierarchie.cfc?method=getTree&periodId=${periodeId}&hid=&_=${Date.now()}`;
const rootNodes: TreeNode[] = await fetchJson(rootUrl);
console.log(`Root nodes: ${rootNodes.length}`);

try {
    await processNodes(rootNodes, null, 0);
    db.exec(`COMMIT`);
    console.log(`All data committed (${count} nodes).`);
} catch (err) {
    try { db.exec(`ROLLBACK`); } catch { /* nothing to roll back */ }
    throw err;
}

try {
    const lectureRow = db.prepare(`SELECT COUNT(DISTINCT unibas_id) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as { n: number } | undefined;
    const placementRow = db.prepare(`SELECT COUNT(*) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as { n: number } | undefined;
    const lectureCount = lectureRow?.n ?? 0;
    const placementCount = placementRow?.n ?? 0;
    console.log(`\nDone. ${count} nodes total, ${lectureCount} unique lectures (${placementCount} tree placements incl. cross-listings) — data/${periodeId}_${lang}.db${insertErrors > 0 ? ` (${insertErrors} insert errors)` : ''}`);
} catch (statsErr: any) {
    console.log(`\nDone (data committed), but stats reporting failed: ${statsErr?.message ?? statsErr}`);
}