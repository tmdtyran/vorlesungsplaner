import { json } from "@sveltejs/kit";
import { getQueueSnapshot } from "$lib/server/importQueue";

// Returns the full queue (pending + currently running item) plus whether
// the queue is globally paused. Polled by the "Warteschlange" overlay.
export async function GET() {
    return json(getQueueSnapshot());
}
