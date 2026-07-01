import { getDb } from "$lib/server/db";
import { parseLectureDetails } from "$lib/server/importer/parser";

export async function POST({ request }) {
    const body = await request.json();
    const { action, periodeId, lang } = body;
    const BASE = "https://vorlesungsverzeichnis.unibas.ch";
    const LANG_PAGE = lang === "de" ? "de/semesterprogramm" : "en/semester-program";

    const stream = new ReadableStream({
        async start(controller) {
            const send = (msg: string) =>
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ log: msg }) + "\n"));

            try {
                const db = getDb(periodeId ?? "default", lang ?? "de");

                if (action === "catalogue") {
                    send(`Importiere Katalog: periodeId=${periodeId}, lang=${lang}`);
                    send(`Datenbank: data/${periodeId}_${lang}.db`);

                    // Step 1: establish language session
                    send(`Establishing ${lang} session...`);
                    const sessionRes = await fetch(`${BASE}/${LANG_PAGE}`, {
                        headers: { "User-Agent": "Mozilla/5.0" }
                    });
                    const rawCookies = sessionRes.headers.getSetCookie?.() ?? [];
                    const cookieHeader = rawCookies.length > 0
                        ? rawCookies.map((c: string) => c.split(";")[0]).join("; ")
                        : (sessionRes.headers.get("set-cookie") ?? "").split(",").map((c: string) => c.trim().split(";")[0]).join("; ");

                    send(cookieHeader ? `Session: ${cookieHeader.slice(0, 60)}...` : "Session: (kein Cookie — Server nutzt Referer)");

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

                    db.exec(`DELETE FROM lecture_times`);
                    db.exec(`DELETE FROM lecture_catalog`);
                    send("Bestehender Katalog gelöscht.");

                    let nodeCount = 0;

                    async function processNodes(nodes: any[], parentKey: string | null, depth: number) {
                        for (const node of nodes) {
                            const hk = parseInt(node.key);
                            if (isNaN(hk)) continue;
                            const d = node.data ?? {};
                            const unibasId = d.unibasId ? Number(d.unibasId) : null;
                            const credits = d.credits ? parseFloat(String(d.credits)) : null;
                            const nodeType = node.lazy ? "folder" : (unibasId ? "lecture" : "group");

                            insertNode.run(hk, unibasId, d.courseNumber ?? null, node.title,
                                credits, d.lecturer ?? null,
                                parentKey ? parseInt(parentKey) : null, nodeType, depth);

                            if (unibasId && d.weekday && d.startTime && d.endTime) {
                                insertTime.run(d.frequency ?? null, d.weekday, d.startTime, d.endTime, hk);
                            }

                            nodeCount++;
                            if (nodeCount % 100 === 0) send(`  ${nodeCount} Knoten verarbeitet...`);

                            if (node.lazy) {
                                await new Promise(r => setTimeout(r, 100));
                                try {
                                    const url = `${BASE}/components/hierarchie.cfc?method=getSubTree&parentid=${node.key}&level=${depth+1}&period=${periodeId}&hid=`;
                                    const children = await fetchJson(url);
                                    if (children?.length) await processNodes(children, node.key, depth + 1);
                                } catch (e: any) {
                                    send(`  ✗ Subtree ${node.key}: ${e?.message}`);
                                }
                            } else if (node.children?.length) {
                                await processNodes(node.children, node.key, depth + 1);
                            }
                        }
                    }

                    send("Fetching root tree...");
                    const rootUrl = `${BASE}/components/hierarchie.cfc?method=getTree&periodId=${periodeId}&hid=&_=${Date.now()}`;
                    const rootNodes = await fetchJson(rootUrl);
                    send(`Root-Knoten: ${rootNodes.length}`);
                    await processNodes(rootNodes, null, 0);

                    const lectureCount = (db.prepare(`SELECT COUNT(*) as n FROM lecture_catalog WHERE unibas_id IS NOT NULL`).get() as any).n;
                    send(`✓ Katalog fertig: ${nodeCount} Knoten, ${lectureCount} Vorlesungen.`);

                } else if (action === "lectures") {
                    const rows = db.prepare(
                        `SELECT unibas_id FROM lecture_catalog WHERE unibas_id IS NOT NULL`
                    ).all() as { unibas_id: number }[];

                    send(`${rows.length} Vorlesungen in data/${periodeId}_${lang}.db`);

                    const langPath = lang === "de" ? "de/kursverzeichnis" : "en/course-directory";
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
                                assessment_details, raw_html, imported_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                                ON CONFLICT(unibas_id) DO UPDATE SET
                                    course_number=excluded.course_number, title=excluded.title,
                                    language=excluded.language, semester=excluded.semester,
                                    offered_by=excluded.offered_by, faculty=excluded.faculty,
                                    lecturers=excluded.lecturers,
                                    assessment_format=excluded.assessment_format,
                                    assessment_details=excluded.assessment_details,
                                    raw_html=excluded.raw_html, imported_at=excluded.imported_at
                            `).run(row.unibas_id, parsed.courseNumber, parsed.title,
                                parsed.language, parsed.semester, parsed.offeredBy,
                                parsed.faculty, parsed.lecturers, parsed.assessmentFormat,
                                parsed.assessmentDetails, html);

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
                            if (success % 10 === 0 || failed > 0) send(`✓ ${success}/${rows.length} — ${parsed.title}`);
                        } catch (err: any) {
                            failed++;
                            send(`✗ ${row.unibas_id}: ${err?.message ?? err}`);
                        }
                    }
                    send(`Fertig: ${success} erfolgreich, ${failed} fehlgeschlagen.`);
                } else {
                    send("Unbekannte Aktion.");
                }
            } catch (err: any) {
                controller.enqueue(new TextEncoder().encode(
                    JSON.stringify({ log: `Fehler: ${err?.message ?? err}` }) + "\n"
                ));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" }
    });
}