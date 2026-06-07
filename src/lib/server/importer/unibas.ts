import * as cheerio from "cheerio";

export interface ImportedLecture {
    unibasId: number;
    courseNumber: string;
    title: string;
    events: {
        date: string;
        startTime: string;
        endTime: string;
        room: string;
    }[];
}

function parseDate(dateString: string): string {
    const parts = dateString.match(/\d+/g);

    if (!parts || parts.length < 3) {
        return dateString;
    }

    const [day, month, year] = parts;

    return `${year}-${month}-${day}`;
}

export async function importLecture(
    unibasId: number
): Promise<ImportedLecture> {
    const response = await fetch(
        `https://vorlesungsverzeichnis.unibas.ch/en/course-directory?id=${unibasId}`,
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0 Safari/537.36"
            }
        }
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    const $ = cheerio.load(html);

    const rawTitle = $("h2").first()
        .text()
        .replace(/\s+/g, " ")
        .trim();

    const courseNumber =
        rawTitle.match(/^(\d{5}-\d{2})/)?.[1] ?? "";

    const title = rawTitle
        .replace(/^(\d{5}-\d{2})\s*-\s*/, "")
        .trim();

    const events = $("table tr")
        .map((_, row) => {
            const cells = $(row)
                .find("td")
                .map((_, td) => $(td).text().trim())
                .get();

            if (cells.length < 3) {
                return null;
            }

            const [dateCell, timeCell, room] = cells;

            const [startTime, endTime] = timeCell
                .split("-")
                .map((s) =>
                    s.replace(
                        /(\d{2})\.(\d{2})/,
                        "$1:$2"
                    )
                );

            return {
                date: parseDate(dateCell),
                startTime,
                endTime,
                room
            };
        })
        .get()
        .filter(Boolean);

    return {
        unibasId,
        courseNumber,
        title,
        events
    };
}

