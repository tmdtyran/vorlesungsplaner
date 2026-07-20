import { json } from "@sveltejs/kit";
import { getJob, jobKey, loadPersistedJob } from "$lib/server/importJobs";
import { enqueueImport } from "$lib/server/importQueue";

// Enqueues an import job and returns immediately — the client polls
// /api/import/logs for progress instead of holding a streaming connection
// open, so the import keeps running even if the tab is closed or switched.
// This always goes through the queue (see importQueue.ts): if nothing else
// is running, the queue starts it right away, which from the user's
// perspective looks identical to the old "start immediately" behaviour; if
// something else is already running, it's simply appended and the caller
// gets a "queued" status back instead of "running".
export async function POST({ request }) {
    const body = await request.json();
    const { action, periodeId, lang } = body;

    if (action !== "catalogue" && action !== "lectures") {
        return json({ error: "Unbekannte Aktion." }, { status: 400 });
    }
    if (!periodeId || periodeId === "default") {
        return json({ error: "Kein Semester ausgewählt." }, { status: 400 });
    }

    const result = enqueueImport(action, periodeId, lang);
    if (result.error) {
        return json({ error: result.error }, { status: 400 });
    }

    return json({ id: result.item!.id, status: result.item!.status });
}

// Quick status check for a single action/periode/lang combo (used on mount
// to decide whether to resume polling for an already-running job). Falls
// back to the persisted log file if there's no in-memory job (e.g. server
// was restarted, or this combo simply isn't the currently-running one).
export async function GET({ url }) {
    const action = url.searchParams.get("action") ?? "";
    const periodeId = url.searchParams.get("periodeId") ?? "";
    const lang = url.searchParams.get("lang") ?? "";
    const job = getJob(jobKey(action, periodeId, lang));
    if (job) return json({ status: job.status, logs: job.logs, error: job.error });

    const persisted = loadPersistedJob(action, periodeId, lang);
    if (!persisted) return json({ status: "idle", logs: [] });
    return json({ status: persisted.status, logs: persisted.logs, error: persisted.error });
}
