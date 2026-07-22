<script lang="ts">
    import { activeSemester, availableSemesters, setActiveSemester, getLabel, type SemesterOption } from '$lib/stores/semester.svelte';
    import { importViewState, pollState, type ImportAction } from '$lib/stores/importViewState.svelte';
    import { t } from '$lib/i18n/translations';
    import QueueOverlay from './QueueOverlay.svelte';

    interface ImportStatusEntry {
        periodeId: string;
        lang: string;
        catalogImportedAt: string | null;
        catalogLectureCount: number | null;
        lecturesImportedAt: string | null;
        lecturesSuccessCount: number | null;
        lecturesTotalCount: number | null;
    }

    interface RunningJob {
        action: ImportAction;
        periodeId: string;
        lang: string;
    }

    const ACTIONS: ImportAction[] = ['catalogue', 'lectures'];

    let fetchingSemesters = $state(false);
    let importStatus = $state<ImportStatusEntry[]>([]);
    let runningJobs = $state<RunningJob[]>([]);

    interface QueueItem {
        id: string;
        action: ImportAction;
        periodeId: string;
        lang: string;
        status: 'queued' | 'running' | 'paused' | 'error';
        addedAt: string;
        progress?: { processedIds: number[]; success: number; failed: number };
        error?: string | null;
    }
    let queueItems = $state<QueueItem[]>([]);
    let queuePaused = $state(false);
    let queueOpen = $state(false);
    let zipInputEl = $state<HTMLInputElement | undefined>(undefined);
    let zipImporting = $state(false);

    const anyImportActive = $derived(queueItems.length > 0);

    // ZIP-imported semesters (see handleZipImport) may not be in the
    // official semester list from "Fetch Semesters" at all — importStatus
    // reflects whatever data folders actually exist on disk regardless.
    // Synthesize a display entry (label = periodeId, since we don't know
    // the real semester name) for any such periodeId so it's still
    // selectable/visible instead of silently missing from both the
    // dropdown and the status table.
    const displaySemesters = $derived.by(() => {
        const known = new Set(availableSemesters.map(s => s.periodeId));
        const extra = importStatus
            .filter(s => !known.has(s.periodeId))
            .map(s => s.periodeId)
            .filter((id, idx, arr) => arr.indexOf(id) === idx)
            .map(periodeId => ({ periodeId, label_de: periodeId, label_en: periodeId }));
        return [...availableSemesters, ...extra];
    });

    function statusFor(periodeId: string, lang: string): ImportStatusEntry | null {
        return importStatus.find(s => s.periodeId === periodeId && s.lang === lang) ?? null;
    }

    function isJobRunning(action: ImportAction, periodeId: string, lang: string): boolean {
        return runningJobs.some(j => j.action === action && j.periodeId === periodeId && j.lang === lang);
    }

    async function loadStatus() {
        try {
            const res = await fetch('/api/import/status');
            if (res.ok) importStatus = await res.json();
        } catch {
            // silently ignore
        }
        try {
            const res = await fetch('/api/import/jobs');
            if (res.ok) runningJobs = await res.json();
        } catch {
            // silently ignore
        }
    }

    async function loadQueue() {
        try {
            const res = await fetch('/api/import/queue');
            if (!res.ok) return;
            const data = await res.json();
            queueItems = data.items ?? [];
            queuePaused = !!data.paused;
        } catch {
            // silently ignore
        }
    }

    // "Import All Lectures" may only be queued once the catalogue for this
    // semester+lang is either already imported, or itself queued/running/
    // paused — mirrors the server-side check in importQueue.ts so the
    // button is disabled up front instead of erroring on click.
    function catalogReady(periodeId: string, lang: string): boolean {
        if (statusFor(periodeId, lang)?.catalogImportedAt) return true;
        return queueItems.some(i => i.action === 'catalogue' && i.periodeId === periodeId && i.lang === lang);
    }

    function queueEntry(action: ImportAction, periodeId: string, lang: string): QueueItem | undefined {
        return queueItems.find(i => i.action === action && i.periodeId === periodeId && i.lang === lang);
    }

    function formatTimestamp(iso: string | null): string {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
            ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    }

    function stopPolling() {
        if (pollState.handle) {
            clearInterval(pollState.handle);
            pollState.handle = null;
        }
    }

    // Loads the (persisted or in-progress) log for one import type without
    // touching polling/currentAction — used to populate the "other" type's
    // log (the one not currently running) whenever it might have gone
    // stale, e.g. on mount or after switching semester/lang.
    async function loadLog(action: ImportAction, periodeId: string, lang: string) {
        try {
            const res = await fetch(`/api/import/logs?action=${action}&periodeId=${periodeId}&lang=${lang}&since=0`);
            if (!res.ok) return;
            const data = await res.json();
            importViewState.logsByAction[action] = data.logs ?? [];
            importViewState.logsSeenByAction[action] = data.total ?? (data.logs?.length ?? 0);
            importViewState.statusByAction[action] = data.status ?? 'idle';
        } catch {
            // ignore — keep whatever we already have
        }
    }

    function startPolling(action: ImportAction, periodeId: string, lang: string) {
        stopPolling();
        importViewState.currentAction = action;

        const poll = async () => {
            try {
                const res = await fetch(`/api/import/logs?action=${action}&periodeId=${periodeId}&lang=${lang}&since=${importViewState.logsSeenByAction[action]}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data.logs?.length) {
                    importViewState.logsByAction[action] = [...importViewState.logsByAction[action], ...data.logs];
                    importViewState.logsSeenByAction[action] += data.logs.length;
                }
                importViewState.statusByAction[action] = data.status;
                if (data.status !== 'running') {
                    stopPolling();
                    if (importViewState.currentAction === action) importViewState.currentAction = null;
                    await loadStatus();
                }
            } catch {
                // network hiccup — keep polling, next tick will retry
            }
        };

        poll();
        pollState.handle = setInterval(poll, 800);
    }

    async function fetchSemesters() {
        fetchingSemesters = true;
        try {
            const res = await fetch('/api/semesters?refresh=1');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: SemesterOption[] = await res.json();
            availableSemesters.splice(0, availableSemesters.length, ...data);
            if (data.length > 0 && importViewState.importPeriodeId === 'default') {
                importViewState.importPeriodeId = data[0].periodeId;
            }
        } catch {
            // ignore — availableSemesters just stays whatever it was
        }
        fetchingSemesters = false;
    }

    async function runImport(action: ImportAction) {
        importViewState.logsByAction[action] = [];
        importViewState.logsSeenByAction[action] = 0;
        importViewState.viewedAction = action;

        try {
            const response = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, periodeId: importViewState.importPeriodeId, lang: importViewState.importLang })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                importViewState.logsByAction[action] = [`${t('Fehler:')} ${data.error ?? response.statusText}`];
                importViewState.statusByAction[action] = 'error';
                return;
            }
            // The server enqueues rather than starting immediately — if
            // nothing else was running this starts right away and the next
            // poll tick (below) picks it up as "running"; otherwise it
            // just sits as "queued" in the overlay until its turn comes.
            importViewState.statusByAction[action] = data.status === 'running' ? 'running' : 'queued';
            if (data.status === 'running') {
                startPolling(action, importViewState.importPeriodeId, importViewState.importLang);
            }
        } catch (err: any) {
            importViewState.logsByAction[action] = [`${t('Fehler:')} ${err?.message ?? err}`];
            importViewState.statusByAction[action] = 'error';
            return;
        }

        await loadStatus();
        await loadQueue();
    }

    // Checks the server for a currently running job for the active
    // semester/lang and, if found, syncs local state to it and (re)attaches
    // polling. Also refreshes the (persisted) log of whichever action isn't
    // running, so switching the log-view toggle always shows something
    // current. Does NOT touch existing state if nothing is running for the
    // polled action — so it's safe to call just to "reconcile", e.g. right
    // after this component (re)mounts, without wiping out a finished job's
    // log.
    async function detectRunningJob(): Promise<boolean> {
        let foundRunning = false;
        for (const action of ACTIONS) {
            try {
                const res = await fetch(`/api/import?action=${action}&periodeId=${importViewState.importPeriodeId}&lang=${importViewState.importLang}`);
                if (!res.ok) continue;
                const data = await res.json();
                if (data.status === 'running') {
                    importViewState.logsByAction[action] = data.logs ?? [];
                    importViewState.logsSeenByAction[action] = importViewState.logsByAction[action].length;
                    importViewState.statusByAction[action] = 'running';
                    startPolling(action, importViewState.importPeriodeId, importViewState.importLang);
                    foundRunning = true;
                } else {
                    await loadLog(action, importViewState.importPeriodeId, importViewState.importLang);
                }
            } catch {
                // ignore
            }
        }
        return foundRunning;
    }

    // Called when the semester/lang selection genuinely changes — that's a
    // real context switch, so the console/status should reset before
    // checking whether a job happens to be running for the newly selected
    // combo.
    async function checkForRunningJob() {
        stopPolling();
        importViewState.logsByAction = { catalogue: [], lectures: [] };
        importViewState.logsSeenByAction = { catalogue: 0, lectures: 0 };
        importViewState.statusByAction = { catalogue: 'idle', lectures: 'idle' };
        importViewState.currentAction = null;
        await detectRunningJob();
    }

    let mountedOnce = false;
    $effect(() => {
        const key = `${importViewState.importPeriodeId}:${importViewState.importLang}`;
        const isNewContext = key !== importViewState.contextKey;
        importViewState.contextKey = key;

        if (isNewContext) {
            checkForRunningJob();
        } else if (!mountedOnce) {
            // First effect run for this component instance, but same
            // context as before — this is a remount (tab switch back, or a
            // page reload), not a real change. Reconcile with the server
            // without discarding whatever we already have locally.
            detectRunningJob();
        }
        mountedOnce = true;
    });

    $effect(() => {
        if (availableSemesters.length === 0) {
            fetch('/api/semesters')
                .then(r => r.json())
                .then((data: SemesterOption[]) => {
                    if (Array.isArray(data) && data.length > 0) {
                        availableSemesters.splice(0, availableSemesters.length, ...data);
                        if (importViewState.importPeriodeId === 'default') importViewState.importPeriodeId = data[0].periodeId;
                    }
                })
                .catch(() => {});
        }
        loadStatus();
        loadQueue();

        // Keep the status overview fresh even when idle, so jobs started
        // from a different browser tab still show up here. Also catches
        // a queued job for the currently selected semester/lang the
        // moment it actually starts running (we don't get pushed an event
        // for that — it just becomes the queue's front item at some point).
        const statusInterval = setInterval(() => {
            loadStatus();
            loadQueue();
            if (!importViewState.currentAction) detectRunningJob();
        }, 1500);
        return () => clearInterval(statusInterval);
    });
    async function handleDeleteData(type: ImportAction, periodeId: string, lang: string, label: string) {
        if (!confirm(`"${label}" ${t('wirklich löschen? Das kann nicht rückgängig gemacht werden.')}`)) return;
        try {
            const res = await fetch('/api/import/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, periodeId, lang })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error ?? t('Löschen fehlgeschlagen.'));
                return;
            }
            await loadStatus();
        } catch (err: any) {
            alert(err?.message ?? t('Löschen fehlgeschlagen.'));
        }
    }

    async function handleCancelImport() {
        const action = importViewState.currentAction;
        if (!action) return;
        try {
            const res = await fetch('/api/import/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, periodeId: importViewState.importPeriodeId, lang: importViewState.importLang })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                importViewState.logsByAction[action] = [...importViewState.logsByAction[action], `${t('Fehler beim Abbrechen:')} ${err.error ?? res.statusText}`];
                return;
            }
            importViewState.logsByAction[action] = [...importViewState.logsByAction[action], t('Abgebrochen — Daten gelöscht.')];
        } catch (err: any) {
            importViewState.logsByAction[action] = [...importViewState.logsByAction[action], `${t('Fehler beim Abbrechen:')} ${err?.message ?? err}`];
        } finally {
            stopPolling();
            importViewState.statusByAction[action] = 'idle';
            importViewState.currentAction = null;
            await loadStatus();
        }
    }

    async function handleZipFilesSelected(e: Event) {
        const input = e.currentTarget as HTMLInputElement;
        const files = input.files;
        if (!files || files.length === 0) return;

        zipImporting = true;
        try {
            const formData = new FormData();
            for (const file of files) formData.append('files', file);

            const res = await fetch('/api/import/zip', { method: 'POST', body: formData });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                alert(data.error ?? t('ZIP-Import fehlgeschlagen.'));
            } else {
                const results: { filename: string; periodeId: string | null; ok: boolean; error?: string }[] = data.results ?? [];
                const failed = results.filter(r => !r.ok);
                if (failed.length > 0) {
                    alert(
                        `${t('Einige ZIPs konnten nicht importiert werden:')}\n` +
                        failed.map(f => `${f.filename}: ${f.error}`).join('\n')
                    );
                }
            }
        } catch (err: any) {
            alert(`${t('ZIP-Import fehlgeschlagen.')} ${err?.message ?? err}`);
        } finally {
            zipImporting = false;
            input.value = ''; // allow re-selecting the same file(s) again later
            await loadStatus();
            await loadQueue();
        }
    }

    function actionLabel(action: ImportAction): string {
        return action === 'catalogue' ? t('Katalog') : t('Alle Vorlesungen');
    }
</script>

<div class="flex h-full flex-col gap-5 p-6">
    <!-- Controls row -->
    <div class="flex flex-wrap items-end gap-4">
        <button
            disabled={fetchingSemesters}
            onclick={fetchSemesters}
            class="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
            {#if fetchingSemesters}
                <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
            {:else}
                <span>🌐</span>
            {/if}
            {t('Fetch Semesters')}
        </button>

        <div class="h-8 w-px bg-slate-200"></div>

        <div class="flex flex-col gap-1">
            <label for="import-semester" class="text-xs font-medium text-slate-500 uppercase tracking-wide">{t('Semester')}</label>
            {#if displaySemesters.length > 0}
                <select
                    id="import-semester"
                    bind:value={importViewState.importPeriodeId}
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                >
                    {#each displaySemesters as s}
                        <option value={s.periodeId}>
                            {importViewState.importLang === 'de' ? s.label_de : s.label_en}
                        </option>
                    {/each}
                </select>
            {:else}
                <select
                    id="import-semester"
                    bind:value={importViewState.importPeriodeId}
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm"
                >
                    <option value="default">{t('— Erst "Fetch Semesters" klicken —')}</option>
                </select>
            {/if}
        </div>

        <div class="flex flex-col gap-1">
            <label for="import-lang" class="text-xs font-medium text-slate-500 uppercase tracking-wide">{t('Sprache')}</label>
            <select
                id="import-lang"
                bind:value={importViewState.importLang}
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
                <option value="de">{t('Deutsch')}</option>
                <option value="en">{t('Englisch')}</option>
            </select>
        </div>

        <div class="ml-auto flex items-center gap-3">
            <input
                type="file"
                accept=".zip"
                multiple
                bind:this={zipInputEl}
                onchange={handleZipFilesSelected}
                class="hidden"
            />
            <button
                disabled={zipImporting}
                onclick={() => zipInputEl?.click()}
                class="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                title={t('Semester-ZIP(s) auswählen und in den Datenordner entpacken (Root-Ordner in der ZIP = Semester-ID, z.B. 2026004/…)')}
            >
                {#if zipImporting}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
                {:else}
                    📦
                {/if}
                {t('ZIP importieren')}
            </button>

            <button
                onclick={() => (queueOpen = !queueOpen)}
                class="relative flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
                📋 {t('Warteschlange')}
                {#if queueItems.length > 0}
                    <span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1 text-xs font-semibold text-white">{queueItems.length}</span>
                {/if}
                {#if queuePaused}
                    <span class="h-2 w-2 rounded-full bg-amber-500" title={t('Warteschlange pausiert')}></span>
                {/if}
            </button>

            {#if importViewState.currentAction}
                <button
                    onclick={handleCancelImport}
                    class="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
                >
                    ✕ {t('Abbrechen')}
                </button>
            {/if}
            <button
                disabled={importViewState.importPeriodeId === 'default' || !!queueEntry('catalogue', importViewState.importPeriodeId, importViewState.importLang)}
                onclick={() => runImport('catalogue')}
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
                {#if importViewState.currentAction === 'catalogue'}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                {anyImportActive ? t('In Warteschlange') : t('Import Catalogue')}
            </button>
            <button
                disabled={importViewState.importPeriodeId === 'default'
                    || !catalogReady(importViewState.importPeriodeId, importViewState.importLang)
                    || !!queueEntry('lectures', importViewState.importPeriodeId, importViewState.importLang)}
                title={!catalogReady(importViewState.importPeriodeId, importViewState.importLang) ? t('Katalog muss zuerst importiert oder eingereiht werden.') : undefined}
                onclick={() => runImport('lectures')}
                class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
                {#if importViewState.currentAction === 'lectures'}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                {anyImportActive ? t('In Warteschlange') : t('Import All Lectures')}
            </button>
        </div>
    </div>

    {#if queueOpen}
        <QueueOverlay
            {queueItems}
            {queuePaused}
            onclose={() => (queueOpen = false)}
            onchange={() => { loadQueue(); loadStatus(); }}
        />
    {/if}

    <!-- Import status overview -->
    {#if displaySemesters.length > 0}
        <div class="rounded-xl border border-slate-200 overflow-hidden">
            <div class="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
                <span class="text-xs font-semibold text-slate-600 uppercase tracking-wide">{t('Import-Status')}</span>
                <span class="text-xs text-slate-400">{t('— pro Semester & Sprache')}</span>
            </div>
            <div class="max-h-48 overflow-y-auto">
                <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-white border-b border-slate-200">
                        <tr>
                            <th class="px-4 py-2 text-left text-xs font-medium text-slate-500">{t('Semester')}</th>
                            <th class="px-3 py-2 text-center text-xs font-medium text-slate-500">{t('DE Katalog')}</th>
                            <th class="px-3 py-2 text-center text-xs font-medium text-slate-500">{t('DE Details')}</th>
                            <th class="px-3 py-2 text-center text-xs font-medium text-slate-500">{t('EN Katalog')}</th>
                            <th class="px-3 py-2 text-center text-xs font-medium text-slate-500">{t('EN Details')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each displaySemesters as s}
                            {@const de = statusFor(s.periodeId, 'de')}
                            {@const en = statusFor(s.periodeId, 'en')}
                            <tr class="border-b border-slate-100 hover:bg-slate-50">
                                <td class="px-4 py-2 text-slate-700">{s.label_de}</td>

                                <td class="px-3 py-2 text-center group" title={de?.catalogImportedAt ? `${de.catalogLectureCount} ${t('Vorlesungen')} — ${formatTimestamp(de.catalogImportedAt)}` : (isJobRunning('catalogue', s.periodeId, 'de') ? t('Import läuft…') : t('Noch nicht importiert'))}>
                                    {#if isJobRunning('catalogue', s.periodeId, 'de')}
                                        <span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                                    {:else if de?.catalogImportedAt}
                                        <button onclick={() => handleDeleteData('catalogue', s.periodeId, 'de', `${t('Katalog DE')} — ${s.label_de}`)} class="text-emerald-600 group-hover:text-red-600" title={t("Löschen")}>
                                            <span class="group-hover:hidden">✓</span><span class="hidden group-hover:inline">🗑</span>
                                        </button>
                                    {:else}
                                        <span class="text-slate-300">—</span>
                                    {/if}
                                </td>
                                <td class="px-3 py-2 text-center group" title={de?.lecturesImportedAt ? `${de.lecturesSuccessCount}/${de.lecturesTotalCount} — ${formatTimestamp(de.lecturesImportedAt)}` : (isJobRunning('lectures', s.periodeId, 'de') ? t('Import läuft…') : t('Noch nicht importiert'))}>
                                    {#if isJobRunning('lectures', s.periodeId, 'de')}
                                        <span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                                    {:else if de?.lecturesImportedAt}
                                        <button onclick={() => handleDeleteData('lectures', s.periodeId, 'de', `${t('Details DE')} — ${s.label_de}`)} class="text-emerald-600 group-hover:text-red-600" title={t("Löschen")}>
                                            <span class="group-hover:hidden">✓</span><span class="hidden group-hover:inline">🗑</span>
                                        </button>
                                    {:else}
                                        <span class="text-slate-300">—</span>
                                    {/if}
                                </td>

                                <td class="px-3 py-2 text-center group" title={en?.catalogImportedAt ? `${en.catalogLectureCount} ${t('Vorlesungen')} — ${formatTimestamp(en.catalogImportedAt)}` : (isJobRunning('catalogue', s.periodeId, 'en') ? t('Import läuft…') : t('Noch nicht importiert'))}>
                                    {#if isJobRunning('catalogue', s.periodeId, 'en')}
                                        <span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                                    {:else if en?.catalogImportedAt}
                                        <button onclick={() => handleDeleteData('catalogue', s.periodeId, 'en', `${t('Katalog EN')} — ${s.label_en}`)} class="text-emerald-600 group-hover:text-red-600" title={t("Löschen")}>
                                            <span class="group-hover:hidden">✓</span><span class="hidden group-hover:inline">🗑</span>
                                        </button>
                                    {:else}
                                        <span class="text-slate-300">—</span>
                                    {/if}
                                </td>
                                <td class="px-3 py-2 text-center group" title={en?.lecturesImportedAt ? `${en.lecturesSuccessCount}/${en.lecturesTotalCount} — ${formatTimestamp(en.lecturesImportedAt)}` : (isJobRunning('lectures', s.periodeId, 'en') ? t('Import läuft…') : t('Noch nicht importiert'))}>
                                    {#if isJobRunning('lectures', s.periodeId, 'en')}
                                        <span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                                    {:else if en?.lecturesImportedAt}
                                        <button onclick={() => handleDeleteData('lectures', s.periodeId, 'en', `${t('Details EN')} — ${s.label_en}`)} class="text-emerald-600 group-hover:text-red-600" title={t("Löschen")}>
                                            <span class="group-hover:hidden">✓</span><span class="hidden group-hover:inline">🗑</span>
                                        </button>
                                    {:else}
                                        <span class="text-slate-300">—</span>
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {/if}

    <!-- Log terminal -->
    <div class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-slate-950 overflow-hidden">
        <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
            <div class="h-2.5 w-2.5 rounded-full bg-red-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-yellow-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-green-500"></div>
            <span class="ml-2 text-xs text-slate-500 font-mono">{t('Import Log')}</span>

            <!-- Katalog / Alle Vorlesungen log toggle -->
            <div class="ml-2 flex overflow-hidden rounded-md border border-slate-700 text-xs font-mono">
                {#each ACTIONS as action}
                    <button
                        onclick={() => (importViewState.viewedAction = action)}
                        class="px-2 py-0.5 transition-colors {importViewState.viewedAction === action ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}"
                    >
                        {actionLabel(action)}
                        {#if importViewState.statusByAction[action] === 'running'}
                            <span class="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse align-middle"></span>
                        {:else if importViewState.statusByAction[action] === 'queued' || importViewState.statusByAction[action] === 'paused'}
                            <span class="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 align-middle"></span>
                        {/if}
                    </button>
                {/each}
            </div>

            {#if importViewState.statusByAction[importViewState.viewedAction] === 'running'}
                <span class="flex items-center gap-1.5 text-xs text-amber-400 font-mono">
                    <span class="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span> {t('läuft…')}
                </span>
            {:else if importViewState.statusByAction[importViewState.viewedAction] === 'queued'}
                <span class="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span> {t('wartet')}
                </span>
            {:else if importViewState.statusByAction[importViewState.viewedAction] === 'paused'}
                <span class="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                    <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span> {t('pausiert')}
                </span>
            {/if}
            {#if importViewState.importPeriodeId !== 'default'}
                <span class="ml-auto text-xs text-slate-600 font-mono">{importViewState.importPeriodeId}/{importViewState.importLang}/lectures.db</span>
            {/if}
        </div>
        <div class="flex-1 overflow-y-auto p-4 font-mono text-sm">
            {#if importViewState.logsByAction[importViewState.viewedAction].length === 0}
                <p class="text-slate-600">{t('Bereit. Klicke "Fetch Semesters" und dann einen Import-Button.')}</p>
            {:else}
                {#each importViewState.logsByAction[importViewState.viewedAction] as log}
                    <p class="leading-6
                        {log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') || log.startsWith('Fehler') ? 'text-red-400' : 'text-slate-300'}
                    ">{log}</p>
                {/each}
            {/if}
        </div>
    </div>
</div>
