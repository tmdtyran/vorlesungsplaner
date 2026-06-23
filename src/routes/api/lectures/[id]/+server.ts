import { json } from '@sveltejs/kit';
import { getLectureDetail } from '$lib/server/lectureRepository';

export async function GET({ params }) {
    const unibasId = parseInt(params.id);
    if (isNaN(unibasId)) {
        return new Response('Invalid ID', { status: 400 });
    }
    const detail = getLectureDetail(unibasId);
    if (!detail) {
        return new Response('Not found', { status: 404 });
    }
    return json(detail);
}
