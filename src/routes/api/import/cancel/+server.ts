import { json } from "@sveltejs/kit";
import { getQueueSnapshot, removeFromQueue } from "$lib/server/importQueue";

// Cancels a currently running (or queued/paused) import and deletes the
// data it was writing — used by the red "Cancel" button shown next to the
// import buttons while a job is in progress, and by the individual remove
// buttons in the queue overlay.
// Goes through the queue rather than importJobs directly: removeFromQueue()
// keeps queue.json consistent (removes the item, not just the running job)
// and cascades — cancelling a catalogue import also removes/cancels its
// paired "all lectures" import if one is queued, since that can no longer
// run meaningfully on its own.
export async function POST({ request }) {
    const { action, periodeId, lang } = await request.json();

    if (action !== "catalogue" && action !== "lectures") {
        return json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
    if (!periodeId || !lang) {
        return json({ error: "periodeId und lang sind erforderlich." }, { status: 400 });
    }

    const item = getQueueSnapshot().items.find(
        i => i.action === action && i.periodeId === periodeId && i.lang === lang
    );
    if (!item) {
        return json({ error: "Kein laufender oder eingereihter Import gefunden." }, { status: 404 });
    }

    removeFromQueue(item.id);

    return json({ ok: true });
}
