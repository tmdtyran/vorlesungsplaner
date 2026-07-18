import { json } from "@sveltejs/kit";
import { clearImportedData } from "$lib/server/db";
import { cancelJob, jobKey, getJob } from "$lib/server/importJobs";

// Cancels a currently running import job and deletes the data it was
// writing — used by the red "Cancel" button shown next to the import
// buttons while a job is in progress.
export async function POST({ request }) {
    const { action, periodeId, lang } = await request.json();

    if (action !== "catalogue" && action !== "lectures") {
        return json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
    if (!periodeId || !lang) {
        return json({ error: "periodeId und lang sind erforderlich." }, { status: 400 });
    }

    const key = jobKey(action, periodeId, lang);
    const job = getJob(key);
    if (!job || job.status !== "running") {
        return json({ error: "Kein laufender Import gefunden." }, { status: 404 });
    }

    cancelJob(key);

    // Best effort: the background loop checks isCancelled() between steps
    // and rolls back/stops as soon as it notices, but we don't wait for it
    // here — clear the data right away so the UI/DB reflect the cancel
    // immediately rather than whatever partial state existed at the moment
    // of the click.
    clearImportedData(periodeId, lang, action);

    return json({ ok: true });
}
