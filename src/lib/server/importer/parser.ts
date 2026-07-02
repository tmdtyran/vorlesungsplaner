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
    date: string;      // ISO format YYYY-MM-DD
    startTime: string; // HH:MM
    endTime: string;   // HH:MM
    room: string;
}

/**
 * UniBasel's detail pages (de/vorlesungsverzeichnis?id=... and
 * en/course-directory?id=...) render all facts as <table><tr><th>Label</th>
 * <td>Value</td></tr></table> blocks — there is no <dt>/<dd> or <h1> as
 * originally (incorrectly) assumed. This parser targets that real structure.
 */
export function parseLectureDetails(html: string, unibasId: number): ParsedLecture {
    const $ = cheerio.load(html);

    // --- Title / course number / credits from the repeated page heading ---
    // Format: "65935-01 - Seminar: Title (6 KP)" or "... (6 CP)" in English.
    let headingText = "";
    $("h1, h2, h3").each((_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (!headingText && /\(\d+(?:[.,]\d+)?\s*(KP|CP)\)/.test(t)) {
            headingText = t;
        }
    });

    let courseNumber: string | null = null;
    let title = `Lecture ${unibasId}`;
    const headerMatch = headingText.match(
        /^([\d]{2,6}-\d{2,3})\s*-\s*([^:]+):\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*(?:KP|CP)\)/
    );
    if (headerMatch) {
        courseNumber = headerMatch[1].trim();
        title = headerMatch[3].trim();
    } else if (headingText) {
        title = headingText;
    }

    // --- Collect every label/value pair from every th+td table row on the page ---
    const fields: Record<string, string> = {};
    $("table").each((_, table) => {
        $(table)
            .find("tr")
            .each((_, row) => {
                const th = $(row).find("th").first();
                const td = $(row).find("td").first();
                if (th.length && td.length) {
                    const label = th.text().replace(/\s+/g, " ").trim().replace(/:$/, "");
                    const value = td.text().replace(/\s+/g, " ").trim();
                    if (label && value) fields[label.toLowerCase()] = value;
                }
            });
    });

    const getField = (...labels: string[]): string | null => {
        for (const l of labels) {
            const v = fields[l.toLowerCase()];
            if (v) return v;
        }
        return null;
    };

    // --- Individual dated sessions ("Einzeltermine" / "Dates") ---
    const events: ParsedEvent[] = [];

    $("table").each((_, table) => {
        const headerCells = $(table)
            .find("tr")
            .first()
            .find("th, td")
            .map((_, el) => $(el).text().trim().toLowerCase())
            .get();

        const looksLikeSessionTable =
            headerCells.some(h => h.includes("datum") || h.includes("date")) &&
            headerCells.some(h => h.includes("zeit") || h.includes("time")) &&
            headerCells.some(h => h.includes("raum") || h.includes("room"));

        if (!looksLikeSessionTable) return;

        $(table)
            .find("tr")
            .slice(1)
            .each((_, row) => {
                const cells = $(row).find("td");
                if (cells.length < 2) return;

                const dateText = $(cells[0]).text().replace(/\s+/g, " ").trim();
                const timeText = $(cells[1]).text().replace(/\s+/g, " ").trim();
                const roomText = cells.length > 2 ? $(cells[2]).text().replace(/\s+/g, " ").trim() : "";

                // "Mittwoch 17.09.2025" / "Thursday 13.03.2025" -> dd.mm.yyyy
                const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
                // "10.15-12.00 Uhr" / "09.15-17.00" -> start/end
                const timeMatch = timeText.match(/(\d{2})[.:](\d{2})\s*-\s*(\d{2})[.:](\d{2})/);

                if (dateMatch && timeMatch) {
                    const isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
                    events.push({
                        date: isoDate,
                        startTime: `${timeMatch[1]}:${timeMatch[2]}`,
                        endTime: `${timeMatch[3]}:${timeMatch[4]}`,
                        room: roomText
                    });
                }
            });
    });

    return {
        courseNumber,
        title,
        language: getField("Unterrichtssprache", "Language of instruction"),
        semester: getField("Semester"),
        offeredBy: getField("Anbietende Organisationseinheit", "Offered by"),
        faculty: getField("Zuständige Fakultät", "Responsible faculty"),
        lecturers: getField("Dozierende", "Lecturers"),
        assessmentFormat: getField("Prüfung", "Assessment format"),
        assessmentDetails: getField("Hinweise zur Prüfung", "Assessment details"),
        events
    };
}