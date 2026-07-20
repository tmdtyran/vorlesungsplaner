import { json } from "@sveltejs/kit";
import { pauseQueue } from "$lib/server/importQueue";

// Pauses the whole queue: the currently running job is asked to stop at
// its next checkpoint without deleting its data, and no further queued
// items start until /api/import/queue/resume is called.
export async function POST() {
    pauseQueue();
    return json({ ok: true });
}
