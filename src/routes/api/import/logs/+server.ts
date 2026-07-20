import { json } from "@sveltejs/kit";
import { getJob, jobKey, loadPersistedJob } from "$lib/server/importJobs";

// Poll-based log retrieval: client passes `since` (number of log lines
// already seen) and gets only the new lines back, plus current status.
// Works whether the job was started this session or is a still-running job
// resumed after a page reload / tab switch — the registry lives server-side.
// If there's no in-memory job (e.g. after a server restart, or the client is
// just looking at the "other" import type's history while it isn't
// running), falls back to the persisted log file on disk.
export async function GET({ url }) {
    const action = url.searchParams.get("action") ?? "";
    const periodeId = url.searchParams.get("periodeId") ?? "";
    const lang = url.searchParams.get("lang") ?? "";
    const since = parseInt(url.searchParams.get("since") ?? "0") || 0;

    const job = getJob(jobKey(action, periodeId, lang));
    if (job) {
        return json({
            status: job.status,
            logs: job.logs.slice(since),
            total: job.logs.length,
            error: job.error
        });
    }

    const persisted = loadPersistedJob(action, periodeId, lang);
    if (!persisted) {
        return json({ status: "idle", logs: [], total: 0, error: null });
    }

    return json({
        status: persisted.status,
        logs: persisted.logs.slice(since),
        total: persisted.logs.length,
        error: persisted.error
    });
}
