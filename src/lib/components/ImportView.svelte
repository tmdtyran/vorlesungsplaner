<script lang="ts">
    import { activeSemester, availableSemesters, setActiveSemester, getLabel, type SemesterOption } from '$lib/stores/semester.svelte';
    import { importViewState, pollState } from '$lib/stores/importViewState.svelte';
    import { t } from '$lib/i18n/translations';

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
        action: 'catalogue' | 'lectures';
        periodeId: string;
        lang: string;
    }

    let fetchingSemesters = $state(false);
    let importStatus = $state<ImportStatusEntry[]>([]);
    let runningJobs = $state<RunningJob[]>([]);

    function statusFor(periodeId: string, lang: string): ImportStatusEntry | null {
        return importStatus.find(s => s.periodeId === periodeId && s.lang === lang) ?? null;
    }

    function isJobRunning(action: 'catalogue' | 'lectures', periodeId: string, lang: string): boolean {
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

    function startPolling(action: 'catalogue' | 'lectures', periodeId: string, lang: string) {
        stopPolling();
        importViewState.currentAction = action;

        const poll = async () => {
            try {
                const res = await fetch(`/api/import/logs?action=${action}&periodeId=${periodeId}&lang=${lang}&since=${importViewState.logsSeen}`);
                if (!res.ok) return;
                const data = await res.json();
                if (data.logs?.length) {
                    importViewState.logs = [...importViewState.logs, ...data.logs];
                    importViewState.logsSeen += data.logs.length;
                }
                importViewState.jobStatus = data.status;
                if (data.status !== 'running') {
                    stopPolling();
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

    async function runImport(action: 'catalogue' | 'lectures') {
        importViewState.logs = [];
        importViewState.logsSeen = 0;
        importViewState.jobStatus = 'running';

        try {
            const response = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, periodeId: importViewState.importPeriodeId, lang: importViewState.importLang })
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                importViewState.logs = [`${t('Fehler:')} ${err.error ?? response.statusText}`];
                importViewState.jobStatus = 'error';
                return;
            }
        } catch (err: any) {
            importViewState.logs = [`${t('Fehler:')} ${err?.message ?? err}`];
            importViewState.jobStatus = 'error';
            return;
        }

        startPolling(action, importViewState.importPeriodeId, importViewState.importLang);
        await loadStatus();
    }

    // Checks the server for a currently running job for the active
    // semester/lang and, if found, syncs local state to it and (re)attaches
    // polling. Does NOT touch existing state if nothing is running — so it's
    // safe to call just to "reconcile", e.g. right after this component
    // (re)mounts, without wiping out a finished job's log.
    async function detectRunningJob(): Promise<boolean> {
        for (const action of ['catalogue', 'lectures'] as const) {
            try {
                const res = await fetch(`/api/import?action=${action}&periodeId=${importViewState.importPeriodeId}&lang=${importViewState.importLang}`);
                if (!res.ok) continue;
                const data = await res.json();
                if (data.status === 'running') {
                    importViewState.logs = data.logs ?? [];
                    importViewState.logsSeen = importViewState.logs.length;
                    importViewState.jobStatus = 'running';
                    startPolling(action, importViewState.importPeriodeId, importViewState.importLang);
                    return true;
                }
            } catch {
                // ignore
            }
        }
        return false;
    }

    // Called when the semester/lang selection genuinely changes — that's a
    // real context switch, so the console/status should reset before
    // checking whether a job happens to be running for the newly selected
    // combo.
    async function checkForRunningJob() {
        stopPolling();
        importViewState.logs = [];
        importViewState.logsSeen = 0;
        importViewState.jobStatus = 'idle';
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

        // Keep the status overview fresh even when idle, so jobs started
        // from a different browser tab still show up here.
        const statusInterval = setInterval(loadStatus, 4000);
        return () => clearInterval(statusInterval);
    });
    async function handleDeleteData(type: 'catalogue' | 'lectures', periodeId: string, lang: string, label: string) {
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
        if (!importViewState.currentAction) return;
        try {
            const res = await fetch('/api/import/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: importViewState.currentAction, periodeId: importViewState.importPeriodeId, lang: importViewState.importLang })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                importViewState.logs = [...importViewState.logs, `${t('Fehler beim Abbrechen:')} ${err.error ?? res.statusText}`];
                return;
            }
            importViewState.logs = [...importViewState.logs, t('Abgebrochen — Daten gelöscht.')];
        } catch (err: any) {
            importViewState.logs = [...importViewState.logs, `${t('Fehler beim Abbrechen:')} ${err?.message ?? err}`];
        } finally {
            stopPolling();
            importViewState.jobStatus = 'idle';
            importViewState.currentAction = null;
            await loadStatus();
        }
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
            {#if availableSemesters.length > 0}
                <select
                    id="import-semester"
                    bind:value={importViewState.importPeriodeId}
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                >
                    {#each availableSemesters as s}
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

        <div class="ml-auto flex gap-3">
            {#if importViewState.jobStatus === 'running'}
                <button
                    onclick={handleCancelImport}
                    class="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
                >
                    ✕ {t('Abbrechen')}
                </button>
            {/if}
            <button
                disabled={importViewState.jobStatus === 'running' || importViewState.importPeriodeId === 'default'}
                onclick={() => runImport('catalogue')}
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
                {#if importViewState.jobStatus === 'running' && importViewState.currentAction === 'catalogue'}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                {t('Import Catalogue')}
            </button>
            <button
                disabled={importViewState.jobStatus === 'running' || importViewState.importPeriodeId === 'default'}
                onclick={() => runImport('lectures')}
                class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
                {#if importViewState.jobStatus === 'running' && importViewState.currentAction === 'lectures'}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                {t('Import All Lectures')}
            </button>
        </div>
    </div>

    <!-- Import status overview -->
    {#if availableSemesters.length > 0}
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
                        {#each availableSemesters as s}
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
            {#if importViewState.jobStatus === 'running'}
                <span class="flex items-center gap-1.5 text-xs text-amber-400 font-mono">
                    <span class="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span> {t('läuft…')}
                </span>
            {/if}
            {#if importViewState.importPeriodeId !== 'default'}
                <span class="ml-auto text-xs text-slate-600 font-mono">{importViewState.importPeriodeId}_{importViewState.importLang}.db</span>
            {/if}
        </div>
        <div class="flex-1 overflow-y-auto p-4 font-mono text-sm">
            {#if importViewState.logs.length === 0}
                <p class="text-slate-600">{t('Bereit. Klicke "Fetch Semesters" und dann einen Import-Button.')}</p>
            {:else}
                {#each importViewState.logs as log}
                    <p class="leading-6
                        {log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') || log.startsWith('Fehler') ? 'text-red-400' : 'text-slate-300'}
                    ">{log}</p>
                {/each}
            {/if}
        </div>
    </div>
</div>
