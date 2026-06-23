import { db } from "../src/lib/server/db";
import { fetchLectureHtml } from "../src/lib/server/importer/unibas";

const rows = db.prepare(`
    SELECT unibas_id
    FROM lecture_catalog
`).all() as {
    unibas_id: number;
}[];

for (const row of rows) {

    console.log(
        "FETCH",
        row.unibas_id
    );

    try {

        const html =
            await fetchLectureHtml(
                row.unibas_id
            );

        db.prepare(`
            INSERT INTO lecture_details
            (
                unibas_id,
                raw_html,
                imported_at
            )
            VALUES
            (
                ?, ?, datetime('now')
            )
            ON CONFLICT(unibas_id)
            DO UPDATE SET
                raw_html = excluded.raw_html,
                imported_at = excluded.imported_at
        `).run(
            row.unibas_id,
            html
        );

    } catch (error) {

        console.log(
            "FAILED",
            row.unibas_id,
            error
        );
    }
}