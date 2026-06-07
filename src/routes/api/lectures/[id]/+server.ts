import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';

export async function GET({ params }) {
	const lecture = db
		.prepare(`
			SELECT *
			FROM lectures
			WHERE id = ?
		`)
		.get(params.id);

	if (!lecture) {
		return new Response('Not found', {
			status: 404
		});
	}

	return json(lecture);
}