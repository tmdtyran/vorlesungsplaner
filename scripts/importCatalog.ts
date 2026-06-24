/**
 * importCatalog.ts
 * Fetches the full lecture tree from UniBasel for a given semester and language,
 * then writes every node (folders + leaves) into lecture_catalog.
 *
 * Usage:
 *   bun scripts/importCatalog.ts --periodeId=2025004 --lang=de
 */

import { getDb } from "../src/lib/server/db";

// --- CLI args ---
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith("--"))
        .map(a => { const [k, v] = a.slice(2).split("="); return [k, v]; })
);
const periodeId = args.periodeId ?? "2025004";
const lang      = args.lang ?? "de";

const BASE = "https://vorlesungsverzeichnis.unibas.ch";
const LANG_PATH = lang === "de" ? "de/semesterprogramm" : "en/semester-program";

console.log(`Importing catalogue: periodeId=${periodeId}, lang=${lang}`);
console.log(`Database: data/${periodeId}_${lang}.db`);

const db = getDb(periodeId, lang);

// Clear existing catalog for clean import
db.exec(`DELETE FROM lecture_times`);
db.exec(`DELETE FROM lecture_catalog`);
console.log("Cleared existing catalog.");

// --- Fancytree node shape ---
interface TreeNode {
    key: string;           // numeric string — this is hierarchy_key
    title: string;
    lazy?: boolean;        // true = folder with children to lazy-load
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

// --- DB insert (upsert by hierarchy_key) ---
const insertNode = db.prepare(`
    INSERT INTO lecture_catalog
        (hierarchy_key, unibas_id, course_number, title, credits, lecturer, parent_key, node_type, depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(hierarchy_key) DO UPDATE SET
        unibas_id    = excluded.unibas_id,
        course_number= excluded.course_number,
        title        = excluded.title,
        credits      = excluded.credits,
        lecturer     = excluded.lecturer,
        parent_key   = excluded.parent_key,
        node_type    = excluded.node_type,
        depth        = excluded.depth
`);

const insertTime = db.prepare(`
    INSERT INTO lecture_times (lecture_catalog_id, frequency, weekday, start_time, end_time)
    SELECT id, ?, ?, ?, ? FROM lecture_catalog WHERE hierarchy_key = ?
`);

// --- Fetch helpers ---
async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url: string, attempt = 1): Promise<any> {
    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json, text/javascript, */*",
                "Referer": `${BASE}/${LANG_PATH}`
            }
        });
        if (res.status === 429) {
            console.log(`  Rate limited, waiting ${attempt * 500}ms...`);
            await sleep(attempt * 500);
            return fetchJson(url, attempt + 1);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    } catch (err) {
        if (attempt < 5) {
            await sleep(attempt * 1000);
            return fetchJson(url, attempt + 1);
        }
        throw err;
    }
}

async function fetchSubTree(parentKey: string, level: number): Promise<TreeNode[]> {
    const url = `${BASE}/components/hierarchie.cfc?method=getSubTree&parentid=${parentKey}&level=${level}&period=${periodeId}&hid=`;
    return fetchJson(url);
}

// --- Recursive tree walk ---
let count = 0;

async function processNodes(nodes: TreeNode[], parentKey: string | null, depth: number) {
    for (const node of nodes) {
        const hierarchyKey = parseInt(node.key);
        if (isNaN(hierarchyKey)) continue;

        const d = node.data ?? {};
        const unibasId = d.unibasId ? Number(d.unibasId) : null;
        const credits  = d.credits  ? parseFloat(String(d.credits)) : null;
        const isLeaf   = !node.lazy && !node.children?.length;
        const nodeType = node.lazy ? "folder" : (unibasId ? "lecture" : "group");

        insertNode.run(
            hierarchyKey,
            unibasId,
            d.courseNumber ?? null,
            node.title,
            credits,
            d.lecturer ?? null,
            parentKey ? parseInt(parentKey) : null,
            nodeType,
            depth
        );

        // Insert recurring time slot if present
        if (unibasId && d.weekday && d.startTime && d.endTime) {
            insertTime.run(
                d.frequency ?? null,
                d.weekday,
                d.startTime,
                d.endTime,
                hierarchyKey
            );
        }

        count++;
        if (count % 50 === 0) console.log(`  ${count} nodes processed...`);

        // Lazy-load children
        if (node.lazy) {
            await sleep(80); // polite delay
            try {
                const children = await fetchSubTree(node.key, depth + 1);
                if (children?.length) {
                    await processNodes(children, node.key, depth + 1);
                }
            } catch (err) {
                console.error(`  Failed to load subtree for ${node.key}: ${err}`);
            }
        } else if (node.children?.length) {
            await processNodes(node.children, node.key, depth + 1);
        }
    }
}

// --- Main ---
console.log("Fetching root tree...");
const rootUrl = `${BASE}/components/hierarchie.cfc?method=getTree&periodId=${periodeId}&hid=&_=${Date.now()}`;
const rootNodes: TreeNode[] = await fetchJson(rootUrl);
console.log(`Root nodes: ${rootNodes.length}`);

await processNodes(rootNodes, null, 0);

console.log(`\nDone. ${count} nodes imported into data/${periodeId}_${lang}.db`);

const lectureCount = (db.prepare(`SELECT COUNT(*) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as any).n;
console.log(`Lectures (with unibasId): ${lectureCount}`);