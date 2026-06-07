import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";

export async function GET() {
    const events = db.prepare(`
        SELECT
            e.*,
            l.title
        FROM lecture_events e
        JOIN lectures l
            ON l.id = e.lecture_id
        ORDER BY date
    `).all();

    return json(events);
}
