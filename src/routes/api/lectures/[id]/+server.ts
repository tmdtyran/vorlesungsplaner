import { json } from '@sveltejs/kit';
import { getLectureDetail } from '$lib/server/lectureRepository';

export async function GET({ params, url }) {
    const unibasId = parseInt(params.id);
    if (isNaN(unibasId)) return new Response('Invalid ID', { status: 400 });

    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    const detail = getLectureDetail(unibasId, periodeId, lang);
    if (!detail) return new Response('Not found', { status: 404 });
    return json(detail);
}
