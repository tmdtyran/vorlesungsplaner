import * as cheerio from "cheerio";

export interface ParsedLecture {
    courseNumber: string | null;
    typeLabel: string | null;
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
/**
 * Plain cheerio .text() concatenates all descendant text nodes with no
 * separator, so multi-paragraph field values (content split across <p> or
 * <br> tags) collapse into one run-on line. This clones the cell, converts
 * paragraph/line boundaries into real newlines first, then extracts text —
 * preserving the original paragraph structure.
 */
function cellValueText($: cheerio.CheerioAPI, cell: any): string {
    const $cell = $(cell).clone();
    $cell.find("br").replaceWith("\n");
    $cell.find("li").each((_: number, li: any) => {
        $(li).append("\n");
    });
    $cell.find("p").each((_: number, p: any) => {
        $(p).before("\n\n").after("\n\n");
    });
    $cell.find("div").each((_: number, div: any) => {
        $(div).append("\n");
    });
    let text = $cell.text();
    text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
    text = text.split("\n").map(line => line.trim()).join("\n").trim();
    return text;
}

// A single extracted value occasionally still contains several module names
// run together (e.g. a <ul><li> list without per-item newlines, or several
// rowspan-continuation lines that happened to land on one line) — split on
// the recurring "Modul:"/"Module:" prefix as a defensive fallback.
function splitMergedModules(text: string): string[] {
    const parts = text
        .split(/\n+/)
        .flatMap(line => line.split(/(?=Modul:|Module:)/g))
        .map(s => s.trim())
        .filter(Boolean);
    return parts.length > 0 ? parts : [text];
}

function extractFieldsFromHtml($: cheerio.CheerioAPI): Record<string, string> {
    const fields: Record<string, string> = {};

    $("table").each((_, table) => {
        $(table)
            .find("tr")
            .each((_, row) => {
                const cells = $(row).children("th, td");
                if (cells.length === 2) {
                    const label = $(cells[0]).text().replace(/\s+/g, " ").trim().replace(/:$/, "");
                    const value = cellValueText($, cells[1]);
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
                const value = dd.length ? cellValueText($, dd) : "";
                if (label && value && !fields[label.toLowerCase()]) {
                    fields[label.toLowerCase()] = value;
                }
            });
    });

    return fields;
}

function extractHeadingInfo($: cheerio.CheerioAPI, unibasId: number): { courseNumber: string | null; typeLabel: string | null; title: string; credits: number | null } {
    let headingText = "";
    $("h1, h2, h3").each((_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        if (!headingText && /\(\d+(?:[.,]\d+)?\s*(KP|CP)\)/.test(t)) {
            headingText = t;
        }
    });

    let courseNumber: string | null = null;
    let typeLabel: string | null = null;
    let credits: number | null = null;
    let title = `Lecture ${unibasId}`;
    const headerMatch = headingText.match(
        /^([\d]{2,6}-\d{2,3})\s*-\s*([^:]+):\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*(?:KP|CP)\)/
    );
    if (headerMatch) {
        courseNumber = headerMatch[1].trim();
        typeLabel = headerMatch[2].trim();
        title = headerMatch[3].trim();
        credits = parseFloat(headerMatch[4].replace(',', '.'));
    } else if (headingText) {
        title = headingText;
    }
    return { courseNumber, typeLabel, title, credits };
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
                if (cells.length < 1) return;

                // Classify cells by content rather than fixed position — some
                // rows have no distinct time cell (e.g. "–" placeholder when
                // the time is already implied by the recurring pattern), so
                // relying on a fixed column index breaks alignment.
                let dateText = "", timeText = "", roomText = "";
                cells.each((_, cell) => {
                    const text = $(cell).text().replace(/\s+/g, " ").trim();
                    if (!text) return;
                    if (!dateText && /\d{2}\.\d{2}\.\d{4}/.test(text)) {
                        dateText = text;
                    } else if (!timeText && /\d{2}[.:]\d{2}\s*-\s*\d{2}[.:]\d{2}/.test(text)) {
                        timeText = text;
                    } else if (!roomText && text !== "–" && text !== "-") {
                        roomText = text;
                    }
                });

                const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
                if (!dateMatch) return;
                const timeMatch = timeText.match(/(\d{2})[.:](\d{2})\s*-\s*(\d{2})[.:](\d{2})/);

                events.push({
                    date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
                    startTime: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : "",
                    endTime: timeMatch ? `${timeMatch[3]}:${timeMatch[4]}` : "",
                    room: roomText
                });
            });
    });

    return events;
}

/**
 * The "Module"/"Modules" field is rendered as a table row whose label cell
 * spans multiple rows (rowspan), with each module on its own subsequent row
 * that has only a single (value) cell. A naive "grab the field text and
 * split on commas" breaks because (a) individual module names themselves
 * contain commas, and (b) cheerio's .text() concatenates the separate rows
 * without any separator. This walks the table structurally instead.
 */
function extractModules($: cheerio.CheerioAPI): string[] {
    const modules: string[] = [];

    $("table").each((_, table) => {
        const rows = $(table).find("tr").toArray();

        for (let i = 0; i < rows.length; i++) {
            const cells = $(rows[i]).children("th, td");
            if (cells.length !== 2) continue;

            const label = $(cells[0]).text().replace(/\s+/g, " ").trim().replace(/:$/, "").toLowerCase();
            if (label !== "module" && label !== "modul" && label !== "modules") continue;

            const firstValue = cellValueText($, cells[1]);
            if (firstValue) modules.push(...splitMergedModules(firstValue));

            // Continuation rows: single-cell rows immediately following,
            // covered by the label cell's rowspan (no label of their own).
            let j = i + 1;
            while (j < rows.length) {
                const contCells = $(rows[j]).children("th, td");
                if (contCells.length !== 1) break;
                const value = cellValueText($, contCells[0]);
                if (value) modules.push(...splitMergedModules(value));
                j++;
            }
            i = j - 1;
        }
    });

    return modules;
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
    const { courseNumber, typeLabel, title } = extractHeadingInfo($, unibasId);
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
        typeLabel,
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
    typeLabel: string | null;
    title: string;
    credits: number | null;
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
    const { courseNumber, typeLabel, title, credits } = extractHeadingInfo($, unibasId);
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
    const modules = extractModules($);

    const result: FullLectureDetails = {
        unibasId,
        courseNumber,
        typeLabel,
        title,
        credits,
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
