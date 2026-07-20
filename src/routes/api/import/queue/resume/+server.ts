import { json } from "@sveltejs/kit";
import { resumeQueue } from "$lib/server/importQueue";

// Resumes the queue: the previously paused item (if any) continues from
// its saved progress, and normal auto-advancement resumes.
export async function POST() {
    resumeQueue();
    return json({ ok: true });
}
