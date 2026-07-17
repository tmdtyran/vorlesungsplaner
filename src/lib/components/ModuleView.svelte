<script lang="ts">
    import { selectedLectures } from '$lib/stores/selectedLectures.svelte';
    import { activeSemester } from '$lib/stores/semester.svelte';
    import { goToDetails } from '$lib/stores/navigation.svelte';
    import SelectedLecturesPanel from './SelectedLecturesPanel.svelte';
    import LectureMiniDetail from './LectureMiniDetail.svelte';
    import type { CatalogEntry, LectureDetail } from '$lib/types/lecture';

    let selectedDetail = $state<LectureDetail | null>(null);
    let selectedCatalog = $state<CatalogEntry | null>(null);

    async function handleSelectFromPanel(catalog: CatalogEntry) {
        if (!catalog.unibas_id) return;
        selectedCatalog = catalog;
        try {
            const res = await fetch(`/api/lectures/${catalog.unibas_id}?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`);
            selectedDetail = res.ok ? await res.json() : null;
        } catch {
            selectedDetail = null;
        }
    }

    // Real modules come from the hierarchy: ancestor nodes titled "Modul: ..."
    // (fetched server-side per lecture). "Freie Leistungen" is always offered
    // as an additional option for every lecture, regardless of its modules.
    function getModules(sel: (typeof selectedLectures)[0]): string[] {
        const mods = sel.detail?.modules ?? [];
        const cleaned = mods.map(m => m.replace(/^modul\s*:\s*/i, ''));
        return [...cleaned, 'Freie Leistungen'];
    }

    let search = $state('');

    // Only lectures still active (checked) in "Meine Auswahl" appear here at all.
    const visibleLectures = $derived(selectedLectures.filter(s => s.active));

    // Search only narrows which rows are shown in the table — KP totals
    // below always reflect all active/included lectures, not just the
    // currently filtered/visible rows.
    const displayedLectures = $derived(
        visibleLectures.filter(s => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return s.catalog.title.toLowerCase().includes(q)
                || (s.catalog.course_number ?? '').toLowerCase().includes(q);
        })
    );

    const moduleCredits = $derived(() => {
        const map = new Map<string, number>();
        for (const sel of visibleLectures) {
            if (!sel.included) continue;
            const modules = getModules(sel);
            const moduleName = modules[sel.selectedModuleIndex] ?? modules[0];
            const credits = sel.catalog.credits ?? 0;
            map.set(moduleName, (map.get(moduleName) ?? 0) + credits);
        }
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    });

    const totalCredits = $derived(
        visibleLectures
            .filter(s => s.included)
            .reduce((sum, s) => sum + (s.catalog.credits ?? 0), 0)
    );
</script>

<div class="flex h-full flex-col">
    <!-- Search bar (same height/style as Kursauswahl, spans full width above both columns) -->
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-2 min-h-15 bg-white">
        <div class="relative flex-1 max-w-sm">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
                bind:value={search}
                placeholder="Vorlesungen suchen..."
                class="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            />
        </div>
        <span class="text-xs text-slate-400">{displayedLectures.length} Vorlesungen</span>
    </div>

    <div class="flex flex-1 min-h-0">
    <div class="flex-1 flex flex-col min-w-0">
        {#if visibleLectures.length === 0}
            <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                <span class="text-4xl">📊</span>
                <p class="text-sm">
                    {selectedLectures.length === 0
                        ? 'Keine Vorlesungen ausgewählt.'
                        : 'Alle ausgewählten Vorlesungen sind in "Meine Auswahl" deaktiviert.'}
                </p>
            </div>
        {:else}
            <div class="flex-1 overflow-y-auto">
                <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-white border-b border-slate-200 z-10">
                        <tr>
                            <th class="w-10 px-4 py-3 text-left"></th>
                            <th class="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Vorlesung</th>
                            <th class="w-24 px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide">KP</th>
                            <th class="w-64 px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Modul</th>
                            <th class="w-10 px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {#if displayedLectures.length === 0}
                            <tr><td colspan="5" class="px-4 py-6 text-center text-slate-400 text-sm">Keine Vorlesungen gefunden</td></tr>
                        {/if}
                        {#each displayedLectures as sel (sel.catalog.unibas_id)}
                            {@const modules = getModules(sel)}
                            <tr class="border-b border-slate-100 transition-colors hover:bg-slate-50 {!sel.included ? 'opacity-50' : ''}">
                                <td class="px-4 py-3">
                                    <input
                                        type="checkbox"
                                        checked={sel.included}
                                        onchange={() => sel.included = !sel.included}
                                        class="h-4 w-4 rounded border-slate-300 accent-indigo-600 cursor-pointer"
                                        title="Bei der KP-Berechnung berücksichtigen"
                                    />
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                        {#if sel.catalog.type_label}
                                            <span class="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
                                                {sel.catalog.type_label}
                                            </span>
                                        {/if}
                                        <p class="font-medium text-slate-800" title={sel.catalog.title}>{sel.catalog.title}</p>
                                    </div>
                                    {#if sel.catalog.course_number}
                                        <p class="text-xs text-slate-500">{sel.catalog.course_number}</p>
                                    {/if}
                                    {#if sel.detail?.lecturers}
                                        <p class="text-xs text-slate-400">{sel.detail.lecturers}</p>
                                    {/if}
                                </td>
                                <td class="px-4 py-3 text-center">
                                    <span class="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                                        {sel.catalog.credits ?? '–'}
                                    </span>
                                </td>
                                <td class="px-4 py-3">
                                    <select
                                        bind:value={sel.selectedModuleIndex}
                                        class="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 truncate text-xs focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                                        disabled={!sel.included}
                                    >
                                        {#each modules as mod, mi}
                                            <option value={mi}>{mod}</option>
                                        {/each}
                                    </select>
                                </td>
                                <td class="px-4 py-3 text-center">
                                    <button
                                        onclick={() => sel.catalog.unibas_id && goToDetails(sel.catalog.unibas_id)}
                                        class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold transition-colors hover:bg-indigo-100"
                                        title="Im Details-Tab öffnen"
                                    >→</button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>

            <!-- Summary footer -->
            <div class="border-t border-slate-200 bg-slate-50 p-5">
                <div class="flex flex-wrap gap-6 items-start">
                    <div>
                        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">KP pro Modul</p>
                        <div class="flex flex-wrap gap-3">
                            {#each moduleCredits() as [mod, credits]}
                                <div class="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                                    <span class="text-sm text-slate-700 max-w-48 truncate">{mod}</span>
                                    <span class="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">{credits}</span>
                                </div>
                            {/each}
                            {#if moduleCredits().length === 0}
                                <p class="text-xs text-slate-400">Keine eingeschlossenen Vorlesungen.</p>
                            {/if}
                        </div>
                    </div>
                    <div class="ml-auto text-right">
                        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Gesamt KP</p>
                        <p class="text-3xl font-bold text-indigo-600">{totalCredits}</p>
                        <p class="text-xs text-slate-400">{visibleLectures.filter(s => s.included).length} von {visibleLectures.length} eingeschlossen</p>
                    </div>
                </div>
            </div>
        {/if}

        <LectureMiniDetail detail={selectedDetail} typeLabel={selectedCatalog?.type_label ?? null} credits={selectedCatalog?.credits ?? null} onClose={() => { selectedDetail = null; selectedCatalog = null; }} />
    </div>

    <SelectedLecturesPanel onSelect={handleSelectFromPanel} />
    </div>
</div>
