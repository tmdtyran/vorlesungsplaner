// Parsing for UniBasel catalogue tree node titles (the raw HTML snippet each
// leaf/folder node carries as its `title`). This used to be duplicated
// verbatim in three places (src/lib/server/importRunners.ts,
// scripts/importCatalog.ts, scripts/import_server.ts) — meaning a bugfix
// applied to one of them silently didn't apply to whichever one actually ran.
// It's now a single shared module, and — more importantly — the catalogue
// import no longer persists the *parsed* (fragile, regex-based) fields at
// all. It only stores each node's raw title HTML. Parsing happens on the fly
// (see catalogResolver.ts) whenever the catalog is actually read, using
// whatever this file's logic looks like *right now*. That means: fix a
// parsing bug here, restart/redeploy, and every already-imported semester
// picks up the fix immediately — no need to re-run the (slow, network-heavy)
// catalogue import just because of a parsing tweak.

export interface ParsedLeafTitle {
    courseNumber: string;
    typeLabel: string;
    name: string;
    credits: number;
    unibasId: number | null;
    lecturer: string | null;
    timeSlots: { frequency: string; weekday: string; start: string; end: string }[];
}

export function stripHtml(raw: string): string {
    return raw
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseLeafTitle(raw: string): ParsedLeafTitle | null {
    const decoded = raw
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    const headerMatch = decoded.match(
        /^([\d]{2,6}-\d{2,3})\s*-\s*([^:]+):\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*(?:KP|CP)\)/
    );
    if (!headerMatch) return null;

    const courseNumber = headerMatch[1].trim();
    const typeLabel = headerMatch[2].trim();
    const name = headerMatch[3].trim();
    const credits = parseFloat(headerMatch[4].replace(',', '.'));

    const idMatch =
        decoded.match(/data-watchlist="(\d+)"/) ??
        decoded.match(/\?id=(\d+)/);
    const unibasId = idMatch ? parseInt(idMatch[1]) : null;

    const spanMatches = [...decoded.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)];
    let lecturer: string | null = null;
    const timeSlots: { frequency: string; weekday: string; start: string; end: string }[] = [];

    for (const sp of spanMatches) {
        // When there is no lecturer, the source markup still emits a leading
        // "- " before the schedule (e.g. "- wöchentlich: Montag 16.15-20.00").
        // Strip that bare dash so it isn't mistaken for a "Lecturer - Schedule" separator.
        const text = sp[1].replace(/\s+/g, ' ').trim().replace(/^-\s+/, '');
        const dashIdx = text.indexOf(' - ');
        let lecturerPart = dashIdx >= 0 ? text.slice(0, dashIdx).trim() : text;
        let schedulePart = dashIdx >= 0 ? text.slice(dashIdx + 3).trim() : '';

        // No " - " separator found: this is either just a lecturer name, or —
        // when there is no lecturer at all — a schedule string such as
        // "wöchentlich: Montag 16.15-20.00" or "unregelmässig: Siehe
        // Einzeltermine". A ":" with no " - " separator can only be the
        // latter — real lecturer names never contain a colon — so that
        // alone is enough to tell schedule-only spans apart, without
        // needing to match a fixed list of frequency keywords.
        if (!schedulePart) {
            const freqOnlyMatch = lecturerPart.match(/^([^:]+):\s*(.+)$/);
            if (freqOnlyMatch) {
                schedulePart = lecturerPart;
                lecturerPart = '';
            }
        }

        if (!lecturer && lecturerPart) lecturer = lecturerPart;

        if (schedulePart) {
            const freqMatch = schedulePart.match(/^([^:]+):\s*(.*)$/);
            const frequency = freqMatch ? freqMatch[1].trim() : '';
            const rest = freqMatch ? freqMatch[2] : schedulePart;

            const timeRegex = /([A-ZÄÖÜ][a-zäöüß]+)\s+(\d{2}[.:]\d{2})\s*-\s*(\d{2}[.:]\d{2})/g;
            let m: RegExpExecArray | null;
            while ((m = timeRegex.exec(rest)) !== null) {
                timeSlots.push({
                    frequency,
                    weekday: m[1],
                    start: m[2].replace('.', ':'),
                    end: m[3].replace('.', ':')
                });
            }
        }
    }

    return { courseNumber, typeLabel, name, credits, unibasId, lecturer, timeSlots };
}
