// In-memory registry of background import jobs. Jobs are detached from any
// single HTTP request/response — once started, they keep running on the
// server (as long as the Node/Vite process stays alive) even if the client
// disconnects, switches tabs, or reloads the page. Clients reconnect via
// polling (see /api/import/logs) and replay accumulated logs from the start.

export type JobStatus = "running" | "done" | "error";

export interface ImportJob {
    key: string;
    action: "catalogue" | "lectures";
    periodeId: string;
    lang: string;
    status: JobStatus;
    logs: string[];
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    cancelRequested: boolean;
}

const jobs = new Map<string, ImportJob>();

export function jobKey(action: string, periodeId: string, lang: string): string {
    return `${action}:${periodeId}:${lang}`;
}

export function getJob(key: string): ImportJob | undefined {
    return jobs.get(key);
}

export function getAllJobs(): ImportJob[] {
    return [...jobs.values()];
}

export function isRunning(action: string, periodeId: string, lang: string): boolean {
    const job = jobs.get(jobKey(action, periodeId, lang));
    return job?.status === "running";
}

/**
 * Flags a running job for cancellation. The job runner itself has to check
 * `isCancelled()` (passed into it by startJob) periodically and stop; this
 * only marks the request, it doesn't forcibly interrupt in-flight work.
 */
export function cancelJob(key: string): boolean {
    const job = jobs.get(key);
    if (!job || job.status !== "running") return false;
    job.cancelRequested = true;
    return true;
}

/**
 * Starts a background job unless one with the same key is already running.
 * `runner` receives a `log(msg)` callback to append progress lines and an
 * `isCancelled()` callback it should check periodically, breaking out and
 * returning early if it becomes true; it should throw on fatal failure and
 * otherwise resolve when done.
 * Returns the (possibly pre-existing, already-running) job immediately —
 * the caller does NOT await job completion.
 */
export function startJob(
    action: "catalogue" | "lectures",
    periodeId: string,
    lang: string,
    runner: (log: (msg: string) => void, isCancelled: () => boolean) => Promise<void>
): ImportJob {
    const key = jobKey(action, periodeId, lang);
    const existing = jobs.get(key);
    if (existing && existing.status === "running") {
        return existing;
    }

    const job: ImportJob = {
        key,
        action,
        periodeId,
        lang,
        status: "running",
        logs: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        cancelRequested: false
    };
    jobs.set(key, job);

    const log = (msg: string) => {
        job.logs.push(msg);
    };
    const isCancelled = () => job.cancelRequested;

    // Fire and forget — this promise chain keeps running server-side
    // regardless of whether any client is currently listening.
    runner(log, isCancelled)
        .then(() => {
            job.status = job.cancelRequested ? "error" : "done";
            if (job.cancelRequested) job.error = "Abgebrochen";
            job.finishedAt = new Date().toISOString();
        })
        .catch((err: any) => {
            job.status = "error";
            job.error = job.cancelRequested ? "Abgebrochen" : (err?.message ?? String(err));
            job.finishedAt = new Date().toISOString();
            log(`Fehler: ${job.error}`);
        });

    return job;
}
