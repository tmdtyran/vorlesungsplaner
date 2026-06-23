<script lang="ts">
    import { selectedLectures } from '$lib/stores/selectedLectures.svelte';

    // Parse modules from assessment_format or offered_by field
    // For now we generate plausible module buckets from faculty/offered_by
    function getModules(sel: typeof selectedLectures[0]): string[] {
        const d = sel.detail;
        if (!d) return ['Ohne Modul'];

        const modules: string[] = [];

        // Use offered_by as module groupings if available
        if (d.offered_by) {
            modules.push(d.offered_by);
        }
        if (d.faculty && d.faculty !== d.offered_by) {
            modules.push(d.faculty);
        }
        // Add generic options
        modules.push('Freie Leistungen');
        if (modules.length === 1) modules.push('Hauptfach');

        return modules;
    }

    // Group by selected module for the summary
    const moduleCredits = $derived(() => {
        const map = new Map<string, number>();
        for (const sel of selectedLectures) {
            if (!sel.included) continue;
            const modules = getModules(sel);
            const moduleName = modules[sel.selectedModuleIndex] ?? modules[0];
            const credits = sel.catalog.credits ?? 0;
            map.set(moduleName, (map.get(moduleName) ?? 0) + credits);
        }
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    });

    const totalCredits = $derived(
        selectedLectures
            .filter(s => s.included)
            .reduce((sum, s) => sum + (s.catalog.credits ?? 0), 0)
    );
</script>

<div class="flex h-full flex-col">
    {#if selectedLectures.length === 0}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
            <span class="text-4xl">📊</span>
            <p class="text-sm">Keine Vorlesungen ausgewählt.</p>
        </div>
    {:else}
        <div class="flex-1 overflow-y-auto">
            <table class="w-full text-sm">
                <thead class="sticky top-0 bg-white border-b border-slate-200 z-10">
                    <tr>
                        <th class="w-10 px-4 py-3 text-left"></th>
                        <th class="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Vorlesung</th>
                        <th class="w-24 px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide">KP</th>
                        <th class="w-56 px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Modul</th>
                    </tr>
                </thead>
                <tbody>
                    {#each selectedLectures as sel, i}
                        {@const modules = getModules(sel)}
                        <tr class="border-b border-slate-100 transition-colors hover:bg-slate-50 {!sel.included ? 'opacity-50' : ''}">
                            <td class="px-4 py-3">
                                <input
                                    type="checkbox"
                                    checked={sel.included}
                                    onchange={() => sel.included = !sel.included}
                                    class="h-4 w-4 rounded border-slate-300 accent-indigo-600 cursor-pointer"
                                />
                            </td>
                            <td class="px-4 py-3">
                                <p class="font-medium text-slate-800">{sel.catalog.title}</p>
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
                                    class="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                                    disabled={!sel.included}
                                >
                                    {#each modules as mod, mi}
                                        <option value={mi}>{mod}</option>
                                    {/each}
                                </select>
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
                    <p class="text-xs text-slate-400">{selectedLectures.filter(s => s.included).length} von {selectedLectures.length} eingeschlossen</p>
                </div>
            </div>
        </div>
    {/if}
</div>
