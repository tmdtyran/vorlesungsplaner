<script lang="ts">
    import { activeSemester, availableSemesters, setActiveSemester, getLabel, type SemesterOption } from '$lib/stores/semester.svelte';

    let logs = $state<string[]>([]);
    let loading = $state(false);
    let fetchingSemesters = $state(false);

    // Local copies for import (can differ from active view semester)
    let importPeriodeId = $state(activeSemester.periodeId);
    let importLang = $state(activeSemester.lang);

    async function fetchSemesters() {
        fetchingSemesters = true;
        logs = ['Lade Semesterliste von vorlesungsverzeichnis.unibas.ch...'];
        try {
            const res = await fetch('/api/semesters?refresh=1');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: SemesterOption[] = await res.json();

            // Update global store
            availableSemesters.splice(0, availableSemesters.length, ...data);

            logs = [...logs, `✓ ${data.length} Semester geladen:`];
            for (const s of data.slice(0, 8)) {
                logs = [...logs, `  ${s.periodeId} → DE: ${s.label_de} / EN: ${s.label_en}`];
            }
            if (data.length > 8) logs = [...logs, `  ... und ${data.length - 8} weitere`];
            logs = [...logs, 'Semester-Dropdowns aktualisiert.'];

            // Set import selection to first available
            if (data.length > 0 && importPeriodeId === 'default') {
                importPeriodeId = data[0].periodeId;
            }
        } catch (err: any) {
            logs = [...logs, `✗ Fehler: ${err?.message ?? err}`];
        }
        fetchingSemesters = false;
    }

    async function runImport(action: 'catalogue' | 'lectures') {
        loading = true;
        logs = [`Starte ${action === 'catalogue' ? 'Katalog' : 'Vorlesungs'}-Import...`];
        logs = [...logs, `Semester: ${importPeriodeId}, Sprache: ${importLang}`];

        try {
            const response = await fetch('/api/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, periodeId: importPeriodeId, lang: importLang })
            });

            const reader = response.body?.getReader();
            if (!reader) { logs = [...logs, 'Kein Stream.']; loading = false; return; }

            const decoder = new TextDecoder();
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
                    try { const p = JSON.parse(line); if (p.log) logs = [...logs, p.log]; }
                    catch { logs = [...logs, line]; }
                }
            }
        } catch (err: any) {
            logs = [...logs, `Fehler: ${err?.message ?? err}`];
        }
        loading = false;
    }

    // On mount: try to load cached semesters
    $effect(() => {
        if (availableSemesters.length === 0) {
            fetch('/api/semesters')
                .then(r => r.json())
                .then((data: SemesterOption[]) => {
                    if (Array.isArray(data) && data.length > 0) {
                        availableSemesters.splice(0, availableSemesters.length, ...data);
                        if (importPeriodeId === 'default') importPeriodeId = data[0].periodeId;
                    }
                })
                .catch(() => {});
        }
    });
</script>

<div class="flex h-full flex-col gap-5 p-6">
    <!-- Controls row -->
    <div class="flex flex-wrap items-end gap-4">
        <!-- Fetch Semesters button -->
        <button
            disabled={fetchingSemesters || loading}
            onclick={fetchSemesters}
            class="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
            {#if fetchingSemesters}
                <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
            {:else}
                <span>🌐</span>
            {/if}
            Fetch Semesters
        </button>

        <div class="h-8 w-px bg-slate-200"></div>

        <!-- Semester dropdown -->
        <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">Semester</label>
            {#if availableSemesters.length > 0}
                <select
                    bind:value={importPeriodeId}
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                >
                    {#each availableSemesters as s}
                        <option value={s.periodeId}>
                            {importLang === 'de' ? s.label_de : s.label_en}
                        </option>
                    {/each}
                </select>
            {:else}
                <select
                    bind:value={importPeriodeId}
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm"
                >
                    <option value="default">— Erst "Fetch Semesters" klicken —</option>
                </select>
            {/if}
        </div>

        <!-- Language dropdown -->
        <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-slate-500 uppercase tracking-wide">Sprache</label>
            <select
                bind:value={importLang}
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
            </select>
        </div>

        <!-- Import buttons -->
        <div class="ml-auto flex gap-3">
            <button
                disabled={loading || fetchingSemesters || importPeriodeId === 'default'}
                onclick={() => runImport('catalogue')}
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
                {#if loading}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                Import Catalogue
            </button>
            <button
                disabled={loading || fetchingSemesters || importPeriodeId === 'default'}
                onclick={() => runImport('lectures')}
                class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
                {#if loading}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                Import All Lectures
            </button>
        </div>
    </div>

    <!-- Log terminal -->
    <div class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-slate-950 overflow-hidden">
        <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
            <div class="h-2.5 w-2.5 rounded-full bg-red-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-yellow-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-green-500"></div>
            <span class="ml-2 text-xs text-slate-500 font-mono">Import Log</span>
            {#if importPeriodeId !== 'default'}
                <span class="ml-auto text-xs text-slate-600 font-mono">{importPeriodeId}_{importLang}.db</span>
            {/if}
        </div>
        <div class="flex-1 overflow-y-auto p-4 font-mono text-sm">
            {#if logs.length === 0}
                <p class="text-slate-600">Bereit. Klicke "Fetch Semesters" und dann einen Import-Button.</p>
            {:else}
                {#each logs as log}
                    <p class="leading-6
                        {log.startsWith('✓') ? 'text-emerald-400' : log.startsWith('✗') || log.startsWith('Fehler') ? 'text-red-400' : 'text-slate-300'}
                    ">{log}</p>
                {/each}
            {/if}
        </div>
    </div>
</div>
