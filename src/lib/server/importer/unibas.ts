import * as cheerio from "cheerio";

export interface ImportedLecture {

    unibasId: number;

    courseNumber: string;
    title: string;

    language: string | null;
    semester: string | null;
    offeredBy: string | null;
    faculty: string | null;

    lecturers: string | null;

    assessmentFormat: string | null;
    assessmentDetails: string | null;

    html: string;

    events: {
        date: string;
        startTime: string;
        endTime: string;
        room: string;
    }[];
}

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

export async function importLecture(
    unibasId: number
): Promise<ImportedLecture> {

    let lastError: unknown;

    for (
        let attempt = 1;
        attempt <= 10;
        attempt++
    ) {

        try {

            const response =
                await fetch(
                    `https://vorlesungsverzeichnis.unibas.ch/en/course-directory?id=${unibasId}`,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0"
                        }
                    }
                );

            if (
                response.status === 429
            ) {

                const waitMs =
                    1000;

                console.log(
                    `RATE LIMITED ${unibasId} - waiting ${waitMs}ms`
                );

                await Bun.sleep(
                    waitMs
                );

                continue;
            }

            if (
                !response.ok
            ) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const html =
                await response.text();

            const $ =
                cheerio.load(html);

            const rawTitle =
                $("h2")
                    .first()
                    .text()
                    .replace(
                        /\s+/g,
                        " "
                    )
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
                extractField(
                    $,
                    "Lecturer"
                ) ??
                extractField(
                    $,
                    "Lecturers"
                );

            const language =
                extractField(
                    $,
                    "Language"
                );

            const semester =
                extractField(
                    $,
                    "Semester"
                );

            const offeredBy =
                extractField(
                    $,
                    "Offered by"
                );

            const faculty =
                extractField(
                    $,
                    "Faculty"
                );

            const assessmentFormat =
                extractField(
                    $,
                    "Assessment"
                );

            const assessmentDetails =
                extractField(
                    $,
                    "Assessment details"
                );

            const events =
                $("table tr")
                    .map((_, row) => {

                        const cells =
                            $(row)
                                .find("td")
                                .map(
                                    (_, td) =>
                                        $(td)
                                            .text()
                                            .replace(
                                                /\s+/g,
                                                " "
                                            )
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
                                parts[0]
                                    .trim()
                                    .replace(
                                        ".",
                                        ":"
                                    ),

                            endTime:
                                parts[1]
                                    .trim()
                                    .replace(
                                        ".",
                                        ":"
                                    ),

                            room
                        };
                    })
                    .get()
                    .filter(Boolean);

            await Bun.sleep(100);

            return {
                unibasId,

                courseNumber,
                title,

                language,
                semester,
                offeredBy,
                faculty,

                lecturers,

                assessmentFormat,
                assessmentDetails,

                html,

                events
            };

        } catch (error) {

            lastError =
                error;

            const waitMs =
                1000;

            console.log(
                `RETRY ${attempt}/10 ${unibasId} (${waitMs}ms)`,
                error
            );

            await Bun.sleep(
                waitMs
            );
        }
    }

    throw lastError;
}