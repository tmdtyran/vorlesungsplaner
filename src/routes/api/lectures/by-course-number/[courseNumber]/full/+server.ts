import { json } from '@sveltejs/kit';
import { getCatalogEntryByCourseNumber, getLectureRawHtml } from '$lib/server/lectureRepository';
import { parseFullLectureDetails } from '$lib/server/importer/parser';

// Full 5-section detail view, looked up by the PUBLIC course number (e.g.
// "65935-01" — the identifier shown before every lecture title), not the
// internal database unibas_id.
export async function GET({ params, url }) {
    const courseNumber = decodeURIComponent(params.courseNumber ?? '').trim();
    if (!courseNumber) return new Response('Invalid course number', { status: 400 });

    const periodeId = url.searchParams.get('periodeId') ?? 'default';
    const lang = url.searchParams.get('lang') ?? 'de';

    const entry = getCatalogEntryByCourseNumber(courseNumber, periodeId, lang);
    if (!entry || entry.unibas_id === null) {
        return json(
            { error: `Keine Vorlesung mit Kursnummer "${courseNumber}" gefunden.` },
            { status: 404 }
        );
    }

    const rawHtml = getLectureRawHtml(entry.unibas_id, periodeId, lang);
    if (!rawHtml) {
        return json(
            { error: 'Keine Detaildaten vorhanden. Bitte zuerst "Import All Lectures" ausführen.' },
            { status: 404 }
        );
    }

    const full = parseFullLectureDetails(rawHtml, entry.unibas_id);
    return json(full);
}
