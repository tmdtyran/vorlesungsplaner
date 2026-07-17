import { json } from "@sveltejs/kit";
import { getDb } from "$lib/server/db";
import { parseLectureDetails } from "$lib/server/importer/parser";
import { fetchLectureHtml } from "$lib/server/importer/unibas";

// Re-fetches and re-parses a single lecture from the source (rather than
// the full "Import All Lectures" run), for the refresh button in the
// Details tab — useful when a single lecture was previously blocked/failed
// or its data on the source site has since changed.
export async function POST({ params, url }) {
    const unibasId = parseInt(params.unibasId);
    if (isNaN(unibasId)) return new Response("Invalid ID", { status: 400 });

    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") === "en" ? "en" : "de";

    const db = getDb(periodeId, lang);

    try {
        const html = await fetchLectureHtml(unibasId, lang);
        const parsed = parseLectureDetails(html, unibasId);

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
        `).run(unibasId, parsed.courseNumber, parsed.title,
            parsed.language, parsed.semester, parsed.offeredBy,
            parsed.faculty, parsed.lecturers, parsed.assessmentFormat,
            parsed.assessmentDetails, parsed.content, html);

        const row = db.prepare(
            `SELECT id FROM lecture_details WHERE unibas_id = ?`
        ).get(unibasId) as { id: number };

        db.prepare(`DELETE FROM lecture_detail_events WHERE lecture_detail_id = ?`).run(row.id);
        for (const ev of parsed.events) {
            db.prepare(`
                INSERT INTO lecture_detail_events
                (lecture_detail_id, date, start_time, end_time, room)
                VALUES (?,?,?,?,?)
            `).run(row.id, ev.date, ev.startTime, ev.endTime, ev.room);
        }

        return json({ ok: true });
    } catch (err: any) {
        return json({ ok: false, error: err?.message ?? String(err) }, { status: 502 });
    }
}
