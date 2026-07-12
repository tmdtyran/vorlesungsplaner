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
    content: string | null;
    events: ParsedEvent[];
}

export interface ParsedEvent {
    date: string;      // ISO format YYYY-MM-DD
    startTime: string; // HH:MM
    endTime: string;   // HH:MM
    room: string;
}

/**
 * Scans every <table> row on the page and returns a flat
 * label(lowercased)->value map. UniBasel detail pages render facts as
 * label/value table rows split across several tables (one per tab section:
 * Beschreibung, Teilnahmevoraussetzungen, ...). Some rows use semantic
 * <th>/<td> pairs, others use two plain <td> cells with the label just
 * bold-styled via CSS — this handles both by accepting ANY row with exactly
 * two direct-child cells (th or td), using the first as label.
 */
function extractFieldsFromHtml($: cheerio.CheerioAPI): Record<string, string> {
    const fields: Record<string, string> = {};

    $("table").each((_, table) => {
        $(table)
            .find("tr")
            .each((_, row) => {
                const cells = $(row).children("th, td");
                if (cells.length === 2) {
                    const label = $(cells[0]).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
                    const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
                    if (label && value && !fields[label.toLowerCase()]) {
                        fields[label.toLowerCase()] = value;
                    }
                }
            });
    });

    // Fallback pattern: <dl><dt>Label</dt><dd>Value</dd></dl>
    $("dl").each((_, dl) => {
        $(dl)
            .find("dt")
            .each((_, dt) => {
                const label = $(dt).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
                const dd = $(dt).next("dd");
                const value = dd.length ? dd.text().replace(/\s+/g, " ").trim() : "";
                if (label && value && !fields[label.toLowerCase()]) {
                    fields[label.toLowerCase()] = value;
                }
            });
    });

    return fields;
}

function extractHeadingInfo($: cheerio.CheerioAPI, unibasId: number): { courseNumber: string | null; title: string } {
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
    return { courseNumber, title };
}

function extractSessionEvents($: cheerio.CheerioAPI): ParsedEvent[] {
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

                const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
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

    return events;
}

function extractRecurringPattern($: cheerio.CheerioAPI): { frequency: string; weekday: string; time: string; room: string }[] {
    const rows: { frequency: string; weekday: string; time: string; room: string }[] = [];

    $("table").each((_, table) => {
        const headerCells = $(table)
            .find("tr")
            .first()
            .find("th, td")
            .map((_, el) => $(el).text().trim().toLowerCase())
            .get();

        const looksLikePatternTable =
            headerCells.some(h => h.includes("intervall") || h.includes("interval")) &&
            headerCells.some(h => h.includes("wochentag") || h.includes("weekday"));

        if (!looksLikePatternTable) return;

        $(table)
            .find("tr")
            .slice(1)
            .each((_, row) => {
                const cells = $(row).find("td");
                if (cells.length < 3) return;
                rows.push({
                    frequency: $(cells[0]).text().replace(/\s+/g, " ").trim(),
                    weekday: $(cells[1]).text().replace(/\s+/g, " ").trim(),
                    time: $(cells[2]).text().replace(/\s+/g, " ").trim(),
                    room: cells.length > 3 ? $(cells[3]).text().replace(/\s+/g, " ").trim() : ""
                });
            });
    });

    return rows;
}

/**
 * Lightweight parse used during "Import All Lectures" — extracts just the
 * fields we persist to the database (used for search/filter/mini-panel).
 */
export function parseLectureDetails(html: string, unibasId: number): ParsedLecture {
    const $ = cheerio.load(html);
    const { courseNumber, title } = extractHeadingInfo($, unibasId);
    const fields = extractFieldsFromHtml($);
    const events = extractSessionEvents($);

    const getField = (...labels: string[]): string | null => {
        for (const l of labels) {
            const v = fields[l.toLowerCase()];
            if (v) return v;
        }
        return null;
    };

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
        content: getField("Inhalt", "Content"),
        events
    };
}

// ---------------------------------------------------------------------------
// Full structured parse for the "Details" tab, re-parsed on demand from the
// raw_html already stored during import — no extra network fetch needed.
// ---------------------------------------------------------------------------

export interface FullLectureDetails {
    unibasId: number;
    courseNumber: string | null;
    title: string;
    description: {
        semester: string | null;
        pattern: string | null;      // "Angebotsmuster"
        lecturers: string | null;
        content: string | null;      // "Inhalt"
        learningObjectives: string | null; // "Lernziele"
        remarks: string | null;      // "Bemerkungen"
    };
    admissionRequirements: {
        requirements: string | null;       // "Teilnahmevoraussetzungen"
        registration: string | null;       // "Anmeldung zur Lehrveranstaltung"
        language: string | null;           // "Unterrichtssprache"
        digitalMedia: string | null;       // "Einsatz digitaler Medien"
    };
    datesAndRooms: {
        pattern: { frequency: string; weekday: string; time: string; room: string }[];
        sessions: ParsedEvent[];
    };
    modules: string[];
    assessment: {
        format: string | null;             // "Prüfung"
        details: string | null;            // "Hinweise zur Prüfung"
        registration: string | null;       // "An-/Abmeldung zur Prüfung"
        retake: string | null;             // "Wiederholungsprüfung"
        scale: string | null;              // "Skala"
        retakeOnFail: string | null;       // "Belegen bei Nichtbestehen"
        faculty: string | null;            // "Zuständige Fakultät"
        offeredBy: string | null;          // "Anbietende Organisationseinheit"
    };
    // Only populated when every structured field above came back empty —
    // lets the UI show a raw HTML preview for debugging instead of a
    // silent "nothing found" result.
    debugRawHtmlSnippet?: string;
}

export function parseFullLectureDetails(html: string, unibasId: number): FullLectureDetails {
    const $ = cheerio.load(html);
    const { courseNumber, title } = extractHeadingInfo($, unibasId);
    const fields = extractFieldsFromHtml($);
    const events = extractSessionEvents($);
    const pattern = extractRecurringPattern($);

    const getField = (...labels: string[]): string | null => {
        for (const l of labels) {
            const v = fields[l.toLowerCase()];
            if (v) return v;
        }
        return null;
    };

    // Modules are listed directly as a "Module"/"Modules" field on the page
    // itself (in addition to being derivable from the hierarchy tree).
    const moduleRaw = getField("Module", "Modules");
    const modules = moduleRaw
        ? moduleRaw.split(/,|;/).map(m => m.trim()).filter(Boolean)
        : [];

    const result: FullLectureDetails = {
        unibasId,
        courseNumber,
        title,
        description: {
            semester: getField("Semester"),
            pattern: getField("Angebotsmuster", "Pattern"),
            lecturers: getField("Dozierende", "Lecturers"),
            content: getField("Inhalt", "Content"),
            learningObjectives: getField("Lernziele", "Learning objectives"),
            remarks: getField("Bemerkungen", "Remarks")
        },
        admissionRequirements: {
            requirements: getField("Teilnahmevoraussetzungen", "Admission requirements"),
            registration: getField("Anmeldung zur Lehrveranstaltung", "Registration for the course"),
            language: getField("Unterrichtssprache", "Language of instruction"),
            digitalMedia: getField("Einsatz digitaler Medien", "Use of digital media")
        },
        datesAndRooms: {
            pattern,
            sessions: events
        },
        modules,
        assessment: {
            format: getField("Prüfung", "Assessment format"),
            details: getField("Hinweise zur Prüfung", "Assessment details"),
            registration: getField("An-/Abmeldung zur Prüfung", "Registration/deregistration for assessment"),
            retake: getField("Wiederholungsprüfung", "Repeat assessment"),
            scale: getField("Skala", "Grading scale"),
            retakeOnFail: getField("Belegen bei Nichtbestehen", "Retaking the course if failed"),
            faculty: getField("Zuständige Fakultät", "Responsible faculty"),
            offeredBy: getField("Anbietende Organisationseinheit", "Offered by")
        }
    };

    const hasAnyField =
        Object.values(result.description).some(Boolean) ||
        Object.values(result.admissionRequirements).some(Boolean) ||
        Object.values(result.assessment).some(Boolean) ||
        modules.length > 0;

    if (!hasAnyField) {
        result.debugRawHtmlSnippet = html.slice(0, 3000);
    }

    return result;
}
