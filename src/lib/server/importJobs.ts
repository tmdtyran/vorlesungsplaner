// In-memory registry of background import jobs. Jobs are detached from any
// single HTTP request/response — once started, they keep running on the
// server (as long as the Node/Vite process stays alive) even if the client
// disconnects, switches tabs, or reloads the page. Clients reconnect via
// polling (see /api/import/logs) and replay accumulated logs from the start.
//
// The in-memory registry alone doesn't survive a server restart though, and
// even while the server IS alive there was previously no way to see the log
// of a finished (or still-running, from-before-restart) import after
// navigating away and back — only the currently-selected semester/lang/action
// combo's log lived in memory. Every job is therefore additionally persisted
// to a small JSON file under the DB's own per-semester/per-language folder
// (one file per import type — catalogue vs lectures), updated as the job
// progresses, so both finished and in-progress logs can always be reloaded.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dbSubDir } from "./db";

export type JobStatus = "running" | "done" | "error" | "paused";
export type ImportAction = "catalogue" | "lectures";

export interface ImportJob {
    key: string;
    action: ImportAction;
    periodeId: string;
    lang: string;
    status: JobStatus;
    logs: string[];
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    cancelRequested: boolean;
    pauseRequested: boolean;
    /** Called once the runner has actually stopped, only if the job was
     *  cancelled — used to retry data cleanup/VACUUM after any in-flight
     *  transaction from the runner has truly rolled back/committed. */
    cleanupOnCancel?: () => void;
    /** Called once the runner has settled (done/paused/error), after
     *  status/cleanup have been applied — used by the queue system to
     *  advance to the next queued item. */
    onSettled?: () => void;
}

interface PersistedJob {
    status: JobStatus;
    logs: string[];
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
}

const jobs = new Map<string, ImportJob>();

export function jobKey(action: string, periodeId: string, lang: string): string {
    return `${action}:${periodeId}:${lang}`;
}

function logFilePath(action: string, periodeId: string, lang: string): string {
    return join(dbSubDir(periodeId, lang), "logs", `${action}.json`);
}

function persistJob(job: ImportJob) {
    try {
        const dir = join(dbSubDir(job.periodeId, job.lang), "logs");
        mkdirSync(dir, { recursive: true });
        const payload: PersistedJob = {
            status: job.status,
            logs: job.logs,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            error: job.error
        };
        writeFileSync(logFilePath(job.action, job.periodeId, job.lang), JSON.stringify(payload));
    } catch (err) {
        // Best effort — a failed log write shouldn't ever interrupt an
        // otherwise-successful import.
        console.error(`[importJobs] Log konnte nicht gespeichert werden für ${job.key}:`, err);
    }
}

/**
 * Loads the persisted log for an action/periode/lang combo that has no
 * currently in-memory job (e.g. after a server restart, or simply because
 * the user is viewing the "other" import type's log while it isn't running).
 * Returns null if nothing was ever imported for that combo.
 */
export function loadPersistedJob(action: string, periodeId: string, lang: string): PersistedJob | null {
    try {
        const path = logFilePath(action, periodeId, lang);
        if (!existsSync(path)) return null;
        return JSON.parse(readFileSync(path, "utf-8")) as PersistedJob;
    } catch {
        return null;
    }
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
 * Flags a running job to stop at its next checkpoint *without* deleting its
 * data — unlike cancelJob(). The runner keeps whatever progress it can
 * (e.g. lecture-details already fetched) so a later resume can pick up
 * roughly where it left off instead of starting over.
 */
export function requestPause(key: string): boolean {
    const job = jobs.get(key);
    if (!job || job.status !== "running") return false;
    job.pauseRequested = true;
    return true;
}

/**
 * Starts a background job unless one with the same key is already running.
 * `runner` receives a `log(msg)` callback to append progress lines and an
 * `isCancelled()` callback it should check periodically, breaking out and
 * returning early if it becomes true; it should throw on fatal failure and
 * otherwise resolve when done.
 * `cleanupOnCancel`, if given, is invoked once the runner has actually
 * settled (resolved/rejected) if — and only if — the job was cancelled.
 * Returns the (possibly pre-existing, already-running) job immediately —
 * the caller does NOT await job completion.
 */
export function startJob(
    action: ImportAction,
    periodeId: string,
    lang: string,
    runner: (log: (msg: string) => void, isCancelled: () => boolean, isPaused: () => boolean) => Promise<void>,
    cleanupOnCancel?: () => void,
    onSettled?: () => void
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
        cancelRequested: false,
        pauseRequested: false,
        cleanupOnCancel,
        onSettled
    };
    jobs.set(key, job);
    persistJob(job);

    const log = (msg: string) => {
        job.logs.push(msg);
        persistJob(job);
    };
    const isCancelled = () => job.cancelRequested;
    const isPaused = () => job.pauseRequested;

    // Fire and forget — this promise chain keeps running server-side
    // regardless of whether any client is currently listening.
    runner(log, isCancelled, isPaused)
        .then(() => {
            if (job.cancelRequested) {
                job.status = "error";
                job.error = "Abgebrochen";
            } else if (job.pauseRequested) {
                job.status = "paused";
            } else {
                job.status = "done";
            }
            job.finishedAt = new Date().toISOString();
        })
        .catch((err: any) => {
            job.status = "error";
            job.error = job.cancelRequested ? "Abgebrochen" : (err?.message ?? String(err));
            job.finishedAt = new Date().toISOString();
            log(`Fehler: ${job.error}`);
        })
        .finally(() => {
            persistJob(job);
            if (job.cancelRequested && job.cleanupOnCancel) {
                // The runner has now truly stopped (any transaction it had
                // open has been rolled back/committed), so cleanup — e.g.
                // re-clearing data and retrying the VACUUM — is safe here
                // even if an earlier "immediate" cleanup attempt raced with
                // the runner and partially failed.
                try {
                    job.cleanupOnCancel();
                } catch (err) {
                    console.error(`[importJobs] cleanupOnCancel fehlgeschlagen für ${key}:`, err);
                }
            }
            job.onSettled?.();
        });

    return job;
}
