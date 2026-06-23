import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { fetchLectureHtml } from "$lib/server/importer/unibas";
import { parseLectureDetails } from "$lib/server/importer/parser";

export async function POST({ request }) {
    const body = await request.json();
    const { action, semester, language } = body;

    // Use a streaming-like approach: return a ReadableStream of log lines
    const stream = new ReadableStream({
        async start(controller) {
            const send = (msg: string) => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ log: msg }) + "\n"));
            };

            try {
                if (action === "catalogue") {
                    send(`Importing catalogue for ${semester ?? "all semesters"}, language: ${language ?? "en"}...`);
                    // Catalogue import would call external scripts
                    // For now we return a meaningful message
                    send("Catalogue import triggered. Run: bun run catalog");
                    send("Done.");
                } else if (action === "lectures") {
                    const rows = db.prepare(`
                        SELECT unibas_id FROM lecture_catalog
                        WHERE unibas_id IS NOT NULL
                    `).all() as { unibas_id: number }[];

                    send(`Found ${rows.length} lectures to import.`);

                    let success = 0;
                    let failed = 0;

                    for (const row of rows) {
                        send(`Fetching ${row.unibas_id}...`);
                        try {
                            const html = await fetchLectureHtml(row.unibas_id);
                            const parsed = parseLectureDetails(html, row.unibas_id);

                            db.prepare(`
                                INSERT INTO lecture_details
                                (unibas_id, course_number, title, language, semester,
                                offered_by, faculty, lecturers, assessment_format,
                                assessment_details, raw_html, imported_at)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                                ON CONFLICT(unibas_id) DO UPDATE SET
                                    course_number=excluded.course_number,
                                    title=excluded.title,
                                    language=excluded.language,
                                    semester=excluded.semester,
                                    offered_by=excluded.offered_by,
                                    faculty=excluded.faculty,
                                    lecturers=excluded.lecturers,
                                    assessment_format=excluded.assessment_format,
                                    assessment_details=excluded.assessment_details,
                                    raw_html=excluded.raw_html,
                                    imported_at=excluded.imported_at
                            `).run(
                                row.unibas_id, parsed.courseNumber, parsed.title,
                                parsed.language, parsed.semester, parsed.offeredBy,
                                parsed.faculty, parsed.lecturers, parsed.assessmentFormat,
                                parsed.assessmentDetails, html
                            );

                            const detail = db.prepare(`
                                SELECT id FROM lecture_details WHERE unibas_id = ?
                            `).get(row.unibas_id) as { id: number };

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

                    send(`Import complete: ${success} succeeded, ${failed} failed.`);
                } else {
                    send("Unknown action.");
                }
            } catch (err: any) {
                send(`Fatal error: ${err?.message ?? err}`);
            }

            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/plain",
            "X-Content-Type-Options": "nosniff"
        }
    });
}
