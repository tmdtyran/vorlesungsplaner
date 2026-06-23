import * as cheerio from "cheerio";
import { db } from "../src/lib/server/db";

function parseDate(
    dateString: string
): string {

    const parts =
        dateString.match(/\d+/g);

    if (
        !parts ||
        parts.length < 3
    ) {
        return dateString;
    }

    const [
        day,
        month,
        year
    ] = parts;

    return `${year}-${month}-${day}`;
}

function extractField(
    $: cheerio.CheerioAPI,
    label: string
): string | null {

    const row =
        $("tr")
            .filter((_, el) =>
                $(el)
                    .find("th")
                    .text()
                    .trim()
                    .includes(label)
            )
            .first();

    if (!row.length) {
        return null;
    }

    const value =
        row.find("td")
            .text()
            .replace(/\s+/g, " ")
            .trim();

    return value || null;
}

const rows =
    db.prepare(`
        SELECT
            id,
            unibas_id,
            raw_html
        FROM lecture_details
        WHERE raw_html IS NOT NULL
    `).all() as {
        id: number;
        unibas_id: number;
        raw_html: string;
    }[];

for (const row of rows) {

    console.log(
        "PARSE",
        row.unibas_id
    );

    const $ =
        cheerio.load(
            row.raw_html
        );

    const rawTitle =
        $("h2")
            .first()
            .text()
            .replace(/\s+/g, " ")
            .trim();

    const courseNumber =
        rawTitle.match(
            /^(\d{5}-\d{2})/
        )?.[1] ?? "";

    const title =
        rawTitle
            .replace(
                /^(\d{5}-\d{2})\s*-\s*/,
                ""
            )
            .trim();

    const lecturers =
        extractField($, "Lecturer")
        ??
        extractField($, "Lecturers");

    const language =
        extractField($, "Language");

    const semester =
        extractField($, "Semester");

    const offeredBy =
        extractField($, "Offered by");

    const faculty =
        extractField($, "Faculty");

    const assessmentFormat =
        extractField($, "Assessment");

    const assessmentDetails =
        extractField(
            $,
            "Assessment details"
        );

    db.prepare(`
        UPDATE lecture_details
        SET
            course_number = ?,
            title = ?,

            language = ?,
            semester = ?,
            offered_by = ?,
            faculty = ?,

            lecturers = ?,

            assessment_format = ?,
            assessment_details = ?
        WHERE id = ?
    `).run(
        courseNumber,
        title,

        language,
        semester,
        offeredBy,
        faculty,

        lecturers,

        assessmentFormat,
        assessmentDetails,

        row.id
    );

    db.prepare(`
        DELETE FROM lecture_detail_events
        WHERE lecture_detail_id = ?
    `).run(
        row.id
    );

    const events =
        $("table tr")
            .map((_, tr) => {

                const cells =
                    $(tr)
                        .find("td")
                        .map(
                            (_, td) =>
                                $(td)
                                    .text()
                                    .replace(/\s+/g, " ")
                                    .trim()
                        )
                        .get();

                if (
                    cells.length < 3
                ) {
                    return null;
                }

                const [
                    dateCell,
                    timeCell,
                    room
                ] = cells;

                const parts =
                    timeCell.split(
                        "-"
                    );

                if (
                    parts.length !== 2
                ) {
                    return null;
                }

                return {
                    date: parseDate(
                        dateCell
                    ),
                    startTime:
                        parts[0].trim(),
                    endTime:
                        parts[1].trim(),
                    room
                };
            })
            .get()
            .filter(Boolean) as any[];

    for (
        const event
        of events
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
            row.id,
            event.date,
            event.startTime,
            event.endTime,
            event.room
        );
    }
}