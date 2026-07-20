import { json } from "@sveltejs/kit";
import { reorderQueue } from "$lib/server/importQueue";

// Applies a new queue order (drag-and-drop result from the overlay).
// reorderQueue() enforces that a catalogue import and its paired "all
// lectures" import always stay adjacent with catalogue first, regardless
// of which one the user actually dragged.
export async function POST({ request }) {
    const { orderedIds } = await request.json();
    if (!Array.isArray(orderedIds)) return json({ error: "orderedIds ist erforderlich." }, { status: 400 });
    reorderQueue(orderedIds);
    return json({ ok: true });
}
