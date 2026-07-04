import { json } from "@sveltejs/kit";
import { getDb } from "$lib/server/db";

export async function GET({ url }) {
    const ids = url.searchParams.get("ids");
    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    if (!ids) return json([]);
    const idList = ids.split(",").map(Number).filter(n => !isNaN(n));
    if (idList.length === 0) return json([]);

    const db = getDb(periodeId, lang);
    const placeholders = idList.map(() => "?").join(",");

    const rows = db.prepare(`
        SELECT DISTINCT lt.lecture_catalog_id, lt.weekday, lt.start_time, lt.end_time, lt.frequency,
               lc.title, lc.unibas_id, lc.credits
        FROM lecture_times lt
        JOIN lecture_catalog lc ON lc.id = lt.lecture_catalog_id
        WHERE lt.lecture_catalog_id IN (${placeholders})
    `).all(...idList);

    return json(rows);
}
