// ImportView.svelte is unmounted/remounted every time the user switches
// away from and back to the Import tab (see +page.svelte, which uses
// {#if nav.activeTab === 'import'}). Any state declared with $state()
// inside that component — including the console log, job status, and
// which button shows a spinner/cancel — is lost on every such remount.
// Keeping it here instead means it survives the component being destroyed
// and recreated, and polling keeps running in the background even while
// the Import tab isn't the active one.
import { activeSemester } from './semester.svelte';

export type ImportAction = 'catalogue' | 'lectures';
export type JobStatus = 'idle' | 'queued' | 'running' | 'paused' | 'done' | 'error';

export const importViewState = $state({
    // Logs/status are tracked separately per import type so the log
    // terminal can show either one — including the log of a finished
    // import while the other type is currently running — via the
    // Katalog/Alle Vorlesungen toggle next to the "Import Log" header.
    logsByAction: { catalogue: [] as string[], lectures: [] as string[] },
    logsSeenByAction: { catalogue: 0, lectures: 0 },
    statusByAction: { catalogue: 'idle', lectures: 'idle' } as Record<ImportAction, JobStatus>,
    // Which log the terminal is currently displaying.
    viewedAction: 'catalogue' as ImportAction,
    // Which import (if any) is actually running right now — drives the
    // Cancel button and the button spinners.
    currentAction: null as ImportAction | null,
    importPeriodeId: activeSemester.periodeId,
    importLang: activeSemester.lang,
    // Tracks which (periodeId, lang) combo the state above actually
    // belongs to, so ImportView can tell "just remounted, same context —
    // keep what we have" apart from "user genuinely switched semester/lang
    // — go check the server for that combo's job/logs instead".
    contextKey: `${activeSemester.periodeId}:${activeSemester.lang}`
});

// Not reactive on purpose — just a shared box so the interval handle
// survives the component remounting without fighting Svelte's $state
// proxying of non-plain values.
export const pollState: { handle: ReturnType<typeof setInterval> | null } = { handle: null };
