import { json } from '@sveltejs/kit';
import { getCatalogEntryByUnibasId } from '$lib/server/lectureRepository';

export async function GET({ params, url }) {
    const unibasId = parseInt(params.unibasId);
    if (isNaN(unibasId)) return new Response('Invalid ID', { status: 400 });

    const periodeId = url.searchParams.get('periodeId') ?? 'default';
    const lang = url.searchParams.get('lang') ?? 'de';

    const entry = getCatalogEntryByUnibasId(unibasId, periodeId, lang);
    if (!entry) return new Response('Not found', { status: 404 });
    return json(entry);
}
