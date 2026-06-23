import { db } from "../src/lib/server/db";
import { importLecture } from "../src/lib/server/importer/unibas";

const rows = db.prepare(`
    SELECT unibas_id
    FROM lecture_catalog
`).all() as {
    unibas_id: number;
}[];

for (const row of rows) {

    console.log(
        "IMPORT",
        row.unibas_id
    );

    try {

        const lecture =
            await importLecture(
                row.unibas_id
            );

        db.prepare(`
            INSERT INTO lecture_details
            (
                unibas_id,
                course_number,
                title,

                language,
                semester,
                offered_by,
                faculty,

                lecturers,

                assessment_format,
                assessment_details,

                raw_html,
                imported_at
            )
            VALUES
            (
                ?, ?, ?,
                ?, ?, ?, ?,
                ?,
                ?, ?,
                ?, datetime('now')
            )
            ON CONFLICT(unibas_id)
            DO UPDATE SET

                course_number = excluded.course_number,
                title = excluded.title,

                language = excluded.language,
                semester = excluded.semester,
                offered_by = excluded.offered_by,
                faculty = excluded.faculty,

                lecturers = excluded.lecturers,

                assessment_format =
                    excluded.assessment_format,

                assessment_details =
                    excluded.assessment_details,

                raw_html = excluded.raw_html,
                imported_at = excluded.imported_at
        `).run(

            lecture.unibasId,

            lecture.courseNumber,
            lecture.title,

            lecture.language,
            lecture.semester,
            lecture.offeredBy,
            lecture.faculty,

            lecture.lecturers,

            lecture.assessmentFormat,
            lecture.assessmentDetails,

            lecture.html
        );

        const detail =
            db.prepare(`
                SELECT id
                FROM lecture_details
                WHERE unibas_id = ?
            `).get(
                lecture.unibasId
            ) as {
                id: number;
            };

        db.prepare(`
            DELETE FROM lecture_detail_events
            WHERE lecture_detail_id = ?
        `).run(
            detail.id
        );

        for (
            const event of lecture.events
        ) {

            db.prepare(`
                INSERT INTO lecture_detail_events
                (
                    lecture_detail_id,
                    date,
                    start_time,
                    end_time,
                    room
                )
                VALUES
                (
                    ?, ?, ?, ?, ?
                )
            `).run(
                detail.id,
                event.date,
                event.startTime,
                event.endTime,
                event.room
            );
        }

    } catch (err) {

        console.log(
            "FAILED",
            row.unibas_id,
            err
        );
    }
}