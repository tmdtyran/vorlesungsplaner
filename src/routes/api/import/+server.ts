import { json } from "@sveltejs/kit";
import { getDb } from "$lib/server/db";
import { fetchLectureHtml } from "$lib/server/importer/unibas";
import { parseLectureDetails } from "$lib/server/importer/parser";

export async function POST({ request }) {
    const body = await request.json();
    const { action, periodeId, lang } = body;

    const stream = new ReadableStream({
        async start(controller) {
            const send = (msg: string) => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ log: msg }) + "\n"));
            };

            try {
                const db = getDb(periodeId ?? "default", lang ?? "de");

                if (action === "catalogue") {
                    send(`Importiere Katalog für Periode ${periodeId}, Sprache: ${lang}...`);
                    send(`Datenbank: data/${periodeId}_${lang}.db`);
                    send(`Starte: bun run catalog -- --periodeId=${periodeId} --lang=${lang}`);
                    send("Katalog-Import läuft im Hintergrund. Bitte Terminal prüfen.");

                } else if (action === "lectures") {
                    const rows = db.prepare(
                        `SELECT unibas_id FROM lecture_catalog WHERE unibas_id IS NOT NULL`
                    ).all() as { unibas_id: number }[];

                    send(`${rows.length} Vorlesungen gefunden in ${periodeId}_${lang}.db`);

                    let success = 0, failed = 0;

                    for (const row of rows) {
                        send(`Fetching ${row.unibas_id}...`);
                        try {
                            const langPath = lang === "de" ? "de/kursverzeichnis" : "en/course-directory";
                            const html = await fetch(
                                `https://vorlesungsverzeichnis.unibas.ch/${langPath}?id=${row.unibas_id}`,
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
                            `).run(
                                row.unibas_id, parsed.courseNumber, parsed.title,
                                parsed.language, parsed.semester, parsed.offeredBy,
                                parsed.faculty, parsed.lecturers, parsed.assessmentFormat,
                                parsed.assessmentDetails, html
                            );

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
                            send(`✓ ${row.unibas_id}: ${parsed.title}`);
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
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ log: `Fehler: ${err?.message ?? err}` }) + "\n"));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" }
    });
}
