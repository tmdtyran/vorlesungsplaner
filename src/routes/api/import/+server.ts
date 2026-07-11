import { json } from "@sveltejs/kit";
import { getDb, setImportMeta, clearImportMeta } from "$lib/server/db";
import { parseLectureDetails } from "$lib/server/importer/parser";
import { startJob, getJob, jobKey } from "$lib/server/importJobs";

const BASE = "https://vorlesungsverzeichnis.unibas.ch";

async function runCatalogueImport(periodeId: string, lang: string, log: (msg: string) => void) {
    const db = getDb(periodeId, lang);
    const LANG_PAGE = lang === "de" ? "de/semesterprogramm" : "en/semester-program";

    // Reset status to "in progress" immediately — the overview should show
    // "-"/yellow, not the previous "done" state, the moment a new run starts.
    clearImportMeta(db, ["catalog_imported_at", "catalog_node_count", "catalog_lecture_count"]);

    log(`Importiere Katalog: periodeId=${periodeId}, lang=${lang}`);
    log(`Datenbank: data/${periodeId}_${lang}.db`);

    log(`Establishing ${lang} session...`);
    const sessionRes = await fetch(`${BASE}/${LANG_PAGE}`, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });
    const rawCookies = sessionRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.length > 0
        ? rawCookies.map((c: string) => c.split(";")[0]).join("; ")
        : (sessionRes.headers.get("set-cookie") ?? "").split(",").map((c: string) => c.trim().split(";")[0]).join("; ");

    log(cookieHeader ? `Session: ${cookieHeader.slice(0, 60)}...` : "Session: (kein Cookie — Server nutzt Referer)");

    const reqHeaders: Record<string, string> = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": lang === "de" ? "de-CH,de;q=0.9" : "en-US,en;q=0.9",
        "Referer": `${BASE}/${LANG_PAGE}`,
    };
    if (cookieHeader) reqHeaders["Cookie"] = cookieHeader;

    async function fetchJson(url: string, attempt = 1): Promise<any> {
        const res = await fetch(url, { headers: reqHeaders });
        if (res.status === 429) {
            await new Promise(r => setTimeout(r, attempt * 600));
            return fetchJson(url, attempt + 1);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
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

    db.exec(`DELETE FROM lecture_times`);
    db.exec(`DELETE FROM lecture_catalog`);
    log("Bestehender Katalog gelöscht.");

    function stripHtml(raw: string): string {
        return raw
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

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
            const text = sp[1].replace(/\s+/g, ' ').trim();
            const dashIdx = text.indexOf(' - ');
            const lecturerPart = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : text;
            const schedulePart = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : '';

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

        return { courseNumber, typeLabel, name, credits, unibasId, lecturer, timeSlots };
    }

    let nodeCount = 0;
    let insertErrors = 0;

    async function processNodes(nodes: any[], parentKey: string | null, depth: number) {
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

            try {
                insertNode.run(hk, unibasId, courseNumber, cleanTitle, typeLabel,
                    credits, lecturer,
                    parentKey ? parseInt(parentKey) : null, nodeType, depth);

                if (unibasId && parsed) {
                    for (const slot of parsed.timeSlots) {
                        insertTime.run(slot.frequency, slot.weekday, slot.start, slot.end, hk);
                    }
                }
            } catch (e: any) {
                insertErrors++;
                log(`  ✗ Insert fehlgeschlagen für Knoten ${hk} ("${cleanTitle}"): ${e?.message}`);
            }

            nodeCount++;
            if (nodeCount % 100 === 0) log(`  ${nodeCount} Knoten verarbeitet...`);

            if (node.lazy) {
                await new Promise(r => setTimeout(r, 100));
                try {
                    const url = `${BASE}/components/hierarchie.cfc?method=getSubTree&parentid=${node.key}&level=${depth+1}&period=${periodeId}&hid=`;
                    const children = await fetchJson(url);
                    if (children?.length) await processNodes(children, node.key, depth + 1);
                } catch (e: any) {
                    log(`  ✗ Subtree-Fetch ${node.key} fehlgeschlagen: ${e?.message}`);
                }
            } else if (node.children?.length) {
                await processNodes(node.children, node.key, depth + 1);
            }
        }
    }

    log("Fetching root tree...");
    const rootUrl = `${BASE}/components/hierarchie.cfc?method=getTree&periodId=${periodeId}&hid=&_=${Date.now()}`;
    const rootNodes = await fetchJson(rootUrl);
    log(`Root-Knoten: ${rootNodes.length}`);
    await processNodes(rootNodes, null, 0);

    const lectureCount = (db.prepare(`SELECT COUNT(DISTINCT unibas_id) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as any).n;
    const placementCount = (db.prepare(`SELECT COUNT(*) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as any).n;
    const timeCount = (db.prepare(`SELECT COUNT(*) as n FROM lecture_times`).get() as any).n;
    log(`✓ Katalog fertig: ${nodeCount} Knoten, ${lectureCount} eindeutige Vorlesungen (${placementCount} Platzierungen im Baum, inkl. Cross-Listings), ${timeCount} Zeitslots.${insertErrors > 0 ? ` (${insertErrors} Insert-Fehler)` : ''}`);

    setImportMeta(db, {
        catalog_imported_at: new Date().toISOString(),
        catalog_node_count: String(nodeCount),
        catalog_lecture_count: String(lectureCount)
    });
}

async function runLecturesImport(periodeId: string, lang: string, log: (msg: string) => void) {
    const db = getDb(periodeId, lang);

    clearImportMeta(db, ["lectures_imported_at", "lectures_success_count", "lectures_total_count"]);

    const rows = db.prepare(
        `SELECT DISTINCT unibas_id FROM lecture_catalog WHERE unibas_id IS NOT NULL`
    ).all() as { unibas_id: number }[];

    log(`${rows.length} eindeutige Vorlesungen in data/${periodeId}_${lang}.db`);

    const langPath = lang === "de" ? "de/vorlesungsverzeichnis" : "en/course-directory";
    let success = 0, failed = 0;

    for (const row of rows) {
        try {
            const html = await fetch(
                `${BASE}/${langPath}?id=${row.unibas_id}`,
                { headers: { "User-Agent": "Mozilla/5.0" } }
            ).then(r => r.text());

            const parsed = parseLectureDetails(html, row.unibas_id);

            db.prepare(`
                INSERT INTO lecture_details
                (unibas_id, course_number, title, language, semester,
                offered_by, faculty, lecturers, assessment_format,
                assessment_details, content, raw_html, imported_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                ON CONFLICT(unibas_id) DO UPDATE SET
                    course_number=excluded.course_number, title=excluded.title,
                    language=excluded.language, semester=excluded.semester,
                    offered_by=excluded.offered_by, faculty=excluded.faculty,
                    lecturers=excluded.lecturers,
                    assessment_format=excluded.assessment_format,
                    assessment_details=excluded.assessment_details,
                    content=excluded.content,
                    raw_html=excluded.raw_html, imported_at=excluded.imported_at
            `).run(row.unibas_id, parsed.courseNumber, parsed.title,
                parsed.language, parsed.semester, parsed.offeredBy,
                parsed.faculty, parsed.lecturers, parsed.assessmentFormat,
                parsed.assessmentDetails, parsed.content, html);

            const detail = db.prepare(
                `SELECT id FROM lecture_details WHERE unibas_id = ?`
            ).get(row.unibas_id) as { id: number };

            db.prepare(`DELETE FROM lecture_detail_events WHERE lecture_detail_id = ?`).run(detail.id);
            for (const ev of parsed.events) {
                db.prepare(`
                    INSERT INTO lecture_detail_events
                    (lecture_detail_id, date, start_time, end_time, room)
                    VALUES (?,?,?,?,?)
                `).run(detail.id, ev.date, ev.startTime, ev.endTime, ev.room);
            }
            success++;
            if (success % 10 === 0 || failed > 0) log(`✓ ${success}/${rows.length} — ${parsed.title}`);
        } catch (err: any) {
            failed++;
            log(`✗ ${row.unibas_id}: ${err?.message ?? err}`);
        }
    }
    log(`Fertig: ${success} erfolgreich, ${failed} fehlgeschlagen.`);

    setImportMeta(db, {
        lectures_imported_at: new Date().toISOString(),
        lectures_success_count: String(success),
        lectures_total_count: String(rows.length)
    });
}

// Starts a background job and returns immediately — the client polls
// /api/import/logs for progress instead of holding a streaming connection
// open, so the import keeps running even if the tab is closed or switched.
export async function POST({ request }) {
    const body = await request.json();
    const { action, periodeId, lang } = body;

    if (action !== "catalogue" && action !== "lectures") {
        return json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
    if (!periodeId || periodeId === "default") {
        return json({ error: "Kein Semester ausgewählt." }, { status: 400 });
    }

    const runner = action === "catalogue"
        ? (log: (msg: string) => void) => runCatalogueImport(periodeId, lang, log)
        : (log: (msg: string) => void) => runLecturesImport(periodeId, lang, log);

    const job = startJob(action, periodeId, lang, runner);

    return json({ key: job.key, status: job.status, startedAt: job.startedAt });
}

// Quick status check for a single action/periode/lang combo (used on mount
// to decide whether to resume polling for an already-running job).
export async function GET({ url }) {
    const action = url.searchParams.get("action") ?? "";
    const periodeId = url.searchParams.get("periodeId") ?? "";
    const lang = url.searchParams.get("lang") ?? "";
    const job = getJob(jobKey(action, periodeId, lang));
    if (!job) return json({ status: "idle", logs: [] });
    return json({ status: job.status, logs: job.logs, error: job.error });
}
