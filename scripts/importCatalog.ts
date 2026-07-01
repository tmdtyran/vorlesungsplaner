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
        (hierarchy_key, unibas_id, course_number, title, credits, lecturer, parent_key, node_type, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hierarchy_key) DO UPDATE SET
        unibas_id=excluded.unibas_id, course_number=excluded.course_number,
        title=excluded.title, credits=excluded.credits, lecturer=excluded.lecturer,
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

async function processNodes(nodes: TreeNode[], parentKey: string | null, depth: number) {
    for (const node of nodes) {
        const hk = parseInt(node.key);
        if (isNaN(hk)) continue;

        const d = node.data ?? {};
        const unibasId = d.unibasId ? Number(d.unibasId) : null;
        const credits  = d.credits  ? parseFloat(String(d.credits)) : null;
        const nodeType = node.lazy ? "folder" : (unibasId ? "lecture" : "group");

        insertNode.run(
            hk, unibasId, d.courseNumber ?? null, node.title,
            credits, d.lecturer ?? null,
            parentKey ? parseInt(parentKey) : null,
            nodeType, depth
        );

        if (unibasId && d.weekday && d.startTime && d.endTime) {
            insertTime.run(d.frequency ?? null, d.weekday, d.startTime, d.endTime, hk);
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
                console.error(`  Failed subtree ${node.key}: ${err}`);
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

await processNodes(rootNodes, null, 0);

const lectureCount = (db.prepare(`SELECT COUNT(*) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as any).n;
console.log(`\nDone. ${count} nodes total, ${lectureCount} lectures — data/${periodeId}_${lang}.db`);