import * as cheerio from "cheerio";

export interface ParsedLecture {
    courseNumber: string | null;
    title: string;
    language: string | null;
    semester: string | null;
    offeredBy: string | null;
    faculty: string | null;
    lecturers: string | null;
    assessmentFormat: string | null;
    assessmentDetails: string | null;
    events: ParsedEvent[];
}

export interface ParsedEvent {
    date: string;
    startTime: string;
    endTime: string;
    room: string;
}

export function parseLectureDetails(html: string, unibasId: number): ParsedLecture {
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || `Lecture ${unibasId}`;

    const getField = (label: string): string | null => {
        const el = $(`dt:contains("${label}")`).next("dd");
        return el.length ? el.text().trim() : null;
    };

    const events: ParsedEvent[] = [];

    // Try to parse event table rows
    $("table tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length >= 3) {
            const dateText = $(cells[0]).text().trim();
            const timeText = $(cells[1]).text().trim();
            const room = $(cells[2]).text().trim();

            const timeParts = timeText.split("-").map(t => t.trim());
            if (timeParts.length === 2 && dateText) {
                events.push({
                    date: dateText,
                    startTime: timeParts[0],
                    endTime: timeParts[1],
                    room
                });
            }
        }
    });

    return {
        courseNumber: getField("Course number") ?? getField("Kursnummer"),
        title,
        language: getField("Language") ?? getField("Sprache"),
        semester: getField("Semester"),
        offeredBy: getField("Offered by") ?? getField("Angeboten von"),
        faculty: getField("Faculty") ?? getField("Fakultät"),
        lecturers: getField("Lecturers") ?? getField("Dozierende"),
        assessmentFormat: getField("Assessment format") ?? getField("Prüfungsform"),
        assessmentDetails: getField("Assessment details") ?? getField("Prüfungsdetails"),
        events
    };
}
