import { json } from '@sveltejs/kit';
import { getLectureRawHtml } from '$lib/server/lectureRepository';
import { parseFullLectureDetails } from '$lib/server/importer/parser';

// Full 5-section detail view (Description / Admission Requirements /
// Dates and Rooms / Modules / Assessment), re-parsed on demand from the
// raw_html already stored in the DB during "Import All Lectures" — no
// extra network fetch needed.
export async function GET({ params, url }) {
    const unibasId = parseInt(params.unibasId);
    if (isNaN(unibasId)) return new Response('Invalid ID', { status: 400 });

    const periodeId = url.searchParams.get('periodeId') ?? 'default';
    const lang = url.searchParams.get('lang') ?? 'de';

    const rawHtml = getLectureRawHtml(unibasId, periodeId, lang);
    if (!rawHtml) {
        return json(
            { error: 'Keine Detaildaten vorhanden. Bitte zuerst "Import All Lectures" ausführen.' },
            { status: 404 }
        );
    }

    const full = parseFullLectureDetails(rawHtml, unibasId);
    return json(full);
}
