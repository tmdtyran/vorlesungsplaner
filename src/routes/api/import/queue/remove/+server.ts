import { json } from "@sveltejs/kit";
import { removeFromQueue } from "$lib/server/importQueue";

// Removes a single queue item (cancelling it first if it's the one
// currently running). Cascades: removing a catalogue item also removes its
// paired "all lectures" item if present, since that can't meaningfully run
// on its own — see removeFromQueue().
export async function POST({ request }) {
    const { id } = await request.json();
    if (!id) return json({ error: "id ist erforderlich." }, { status: 400 });
    removeFromQueue(id);
    return json({ ok: true });
}
