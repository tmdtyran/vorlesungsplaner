// Sequential import queue: only one catalogue/lectures import ever runs at
// once. Clicking "Import" while nothing is running starts immediately
// (equivalent to enqueuing into an empty queue); clicking it while
// something IS running just adds the job to the queue instead — see
// enqueueImport(), called unconditionally by the /api/import POST handler.
//
// Persisted to data/queue.json so the queue (including an in-progress
// job's pause/resume state) survives a server restart, not just a client
// reload.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, getDb, getImportMeta, clearImportedData } from "./db";
import { startJob, getJob, jobKey, cancelJob, requestPause, type ImportAction } from "./importJobs";
import { runCatalogueImport, runLecturesImport, type LecturesImportProgress } from "./importRunners";

export interface QueueItem {
    id: string;
    action: ImportAction;
    periodeId: string;
    lang: string;
    status: "queued" | "running" | "paused" | "error";
    addedAt: string;
    progress?: LecturesImportProgress;
    error?: string | null;
}

interface QueueFile {
    items: QueueItem[];
    paused: boolean;
}

const QUEUE_PATH = join(DATA_DIR, "queue.json");

function loadQueueFile(): QueueFile {
    try {
        if (!existsSync(QUEUE_PATH)) return { items: [], paused: false };
        const parsed = JSON.parse(readFileSync(QUEUE_PATH, "utf-8"));
        return { items: Array.isArray(parsed.items) ? parsed.items : [], paused: !!parsed.paused };
    } catch {
        return { items: [], paused: false };
    }
}

const state: QueueFile = loadQueueFile();

function save() {
    try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(QUEUE_PATH, JSON.stringify(state));
    } catch (err) {
        console.error("[importQueue] Konnte Warteschlange nicht speichern:", err);
    }
}

// Startup recovery: an item that was "running" when the process last
// stopped (crash, forced quit, restart) never got the chance to cleanly
// transition to paused — treat it as paused-in-place instead of losing
// track of it, so the next tick() picks it back up (fresh restart for
// catalogue, resumed from its last saved progress for lectures).
for (const item of state.items) {
    if ((item.status as string) === "running") item.status = "paused";
}
save();

function uid(): string {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function getQueueSnapshot(): { items: QueueItem[]; paused: boolean } {
    return { items: state.items, paused: state.paused };
}

function findPair(item: QueueItem): QueueItem | undefined {
    const otherAction: ImportAction = item.action === "catalogue" ? "lectures" : "catalogue";
    return state.items.find(i => i.action === otherAction && i.periodeId === item.periodeId && i.lang === item.lang);
}

function isCatalogImported(periodeId: string, lang: string): boolean {
    try {
        const db = getDb(periodeId, lang);
        const meta = getImportMeta(db);
        return !!meta.catalog_imported_at;
    } catch {
        return false;
    }
}

/** Whether "Import All Lectures" may be queued for this periode+lang right
 *  now — its catalogue must either already be imported, or be somewhere in
 *  the queue (queued/running/paused) so it'll exist by the time this runs. */
export function canEnqueueLectures(periodeId: string, lang: string): boolean {
    if (isCatalogImported(periodeId, lang)) return true;
    return state.items.some(
        i => i.action === "catalogue" && i.periodeId === periodeId && i.lang === lang
    );
}

export function enqueueImport(action: ImportAction, periodeId: string, lang: string): { item?: QueueItem; error?: string } {
    const existing = state.items.find(i => i.action === action && i.periodeId === periodeId && i.lang === lang);
    if (existing) return { item: existing };

    if (action === "lectures" && !canEnqueueLectures(periodeId, lang)) {
        return { error: "Katalog muss zuerst importiert oder eingereiht werden." };
    }

    const item: QueueItem = {
        id: uid(),
        action,
        periodeId,
        lang,
        status: "queued",
        addedAt: new Date().toISOString()
    };
    state.items.push(item);
    save();
    tick();
    return { item };
}

function removeSingle(item: QueueItem) {
    if (item.status === "running") {
        // Cancelling (rather than pausing) deletes the partial data — this
        // is a real removal from the queue, not a pause, so the DB should
        // end up in the same state as if the import had never started.
        // clearImportedData() itself happens via the job's cleanupOnCancel
        // hook once the runner has actually stopped (see startQueueItem).
        cancelJob(jobKey(item.action, item.periodeId, item.lang));
    } else if (item.status === "paused" || item.status === "error") {
        // The runner already stopped on its own (no open transaction to
        // race with), so it's safe to clear+shrink right here rather than
        // needing the settle-hook indirection "running" removal relies on.
        clearImportedData(item.periodeId, item.lang, item.action);
    }
    const idx = state.items.findIndex(i => i.id === item.id);
    if (idx !== -1) state.items.splice(idx, 1);
}

/** Removes a queue item. If it's a catalogue import, its paired "all
 *  lectures" import (if queued) is removed/cancelled along with it, since
 *  it can no longer run meaningfully on its own. */
export function removeFromQueue(id: string) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    const pair = item.action === "catalogue" ? findPair(item) : undefined;

    removeSingle(item);
    if (pair) removeSingle(pair);

    save();
    tick();
}

/**
 * Applies a new order for the (non-running) items, then enforces that a
 * catalogue import and its paired "all lectures" import always travel
 * together with catalogue first: whichever of the two the user actually
 * dragged, its partner is pulled to sit directly after the catalogue item.
 */
export function reorderQueue(orderedIds: string[]) {
    const byId = new Map(state.items.map(i => [i.id, i] as const));
    const reordered: QueueItem[] = [];
    for (const id of orderedIds) {
        const it = byId.get(id);
        if (it) reordered.push(it);
    }
    for (const it of state.items) {
        if (!reordered.includes(it)) reordered.push(it); // anything the client omitted stays, appended
    }

    for (const item of reordered) {
        if (item.action !== "catalogue") continue;
        const pair = reordered.find(
            i => i.action === "lectures" && i.periodeId === item.periodeId && i.lang === item.lang
        );
        if (!pair) continue;
        const catIdx = reordered.indexOf(item);
        if (reordered[catIdx + 1] === pair) continue;
        reordered.splice(reordered.indexOf(pair), 1);
        reordered.splice(reordered.indexOf(item) + 1, 0, pair);
    }

    state.items = reordered;
    save();
}

/** Pauses the whole queue: the currently running job is asked to stop at
 *  its next checkpoint (keeping its progress), and no further queued items
 *  are auto-started until resumeQueue() is called. */
export function pauseQueue() {
    state.paused = true;
    save();
    const running = state.items.find(i => i.status === "running");
    if (running) requestPause(jobKey(running.action, running.periodeId, running.lang));
}

export function resumeQueue() {
    state.paused = false;
    save();
    tick();
}

function updateItemProgress(id: string, progress: LecturesImportProgress) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    item.progress = progress;
    save();
}

function onJobSettled(itemId: string) {
    const item = state.items.find(i => i.id === itemId);
    const job = item ? getJob(jobKey(item.action, item.periodeId, item.lang)) : undefined;

    if (item && job) {
        if (job.status === "done") {
            const idx = state.items.indexOf(item);
            if (idx !== -1) state.items.splice(idx, 1); // finished — drop from the pending queue
        } else if (job.status === "paused") {
            item.status = "paused";
        } else if (job.status === "error") {
            if (!job.cancelRequested) {
                item.status = "error";
                item.error = job.error;
            }
            // if cancelRequested, this was a real removal — already gone
            // from state.items via removeFromQueue(), nothing more to do.
        }
    }
    save();
    tick();
}

function startQueueItem(item: QueueItem) {
    item.status = "running";
    item.error = null;
    save();

    const runner = (log: (msg: string) => void, isCancelled: () => boolean, isPaused: () => boolean) => {
        if (item.action === "catalogue") {
            return runCatalogueImport(item.periodeId, item.lang, log, isCancelled, isPaused);
        }
        return runLecturesImport(
            item.periodeId,
            item.lang,
            log,
            isCancelled,
            isPaused,
            item.progress,
            (progress) => updateItemProgress(item.id, progress)
        );
    };

    const cleanupOnCancel = () => clearImportedData(item.periodeId, item.lang, item.action);

    startJob(item.action, item.periodeId, item.lang, runner, cleanupOnCancel, () => onJobSettled(item.id));
}

/** Starts the next eligible item if nothing is currently running and the
 *  queue isn't paused. Safe to call redundantly (e.g. after every
 *  mutation) — it's a no-op unless there's actually something to do. */
export function tick() {
    if (state.paused) return;
    if (state.items.some(i => i.status === "running")) return;
    // Prefer resuming a paused item before starting a fresh queued one, so
    // a semester's catalogue+lectures pair finishes before the next
    // semester's queued work begins.
    const next = state.items.find(i => i.status === "paused") ?? state.items.find(i => i.status === "queued");
    if (!next) return;
    startQueueItem(next);
}

// Resume automatically on server start (unless the queue was explicitly
// paused before the process last stopped).
tick();
