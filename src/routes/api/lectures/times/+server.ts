import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";

export async function GET({ url }) {
    const ids = url.searchParams.get("ids");
    if (!ids) return json([]);

    const idList = ids.split(",").map(Number).filter(n => !isNaN(n));
    if (idList.length === 0) return json([]);

    const placeholders = idList.map(() => "?").join(",");

    // lecture_times joins via lecture_catalog_id → lecture_catalog.id
    const rows = db.prepare(`
        SELECT
            lt.lecture_catalog_id,
            lt.weekday,
            lt.start_time,
            lt.end_time,
            lt.frequency,
            lc.title,
            lc.unibas_id,
            lc.credits
        FROM lecture_times lt
        JOIN lecture_catalog lc ON lc.id = lt.lecture_catalog_id
        WHERE lt.lecture_catalog_id IN (${placeholders})
    `).all(...idList);

    return json(rows);
}