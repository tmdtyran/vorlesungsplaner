<script lang="ts">
    import { selectedLectures, removeLecture, toggleActive } from '$lib/stores/selectedLectures.svelte';
    import { goToDetails } from '$lib/stores/navigation.svelte';
    import type { CatalogEntry } from '$lib/types/lecture';

    interface Props {
        onSelect?: (catalog: CatalogEntry) => void;
    }
    let { onSelect }: Props = $props();

    let expanded = $state(true);

    function handleRemove(unibasId: number | null, e: MouseEvent) {
        e.stopPropagation();
        removeLecture(unibasId);
    }

    function handleOpenDetails(unibasId: number | null, e: MouseEvent) {
        e.stopPropagation();
        if (unibasId !== null) goToDetails(unibasId);
    }

    function handleToggleActive(unibasId: number | null, e: MouseEvent) {
        e.stopPropagation();
        toggleActive(unibasId);
    }

    const activeCount = $derived(selectedLectures.filter(s => s.active).length);
</script>

{#if expanded}
    <div class="flex flex-col w-72 shrink-0 border-l border-slate-200">
        <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-2 bg-slate-50">
            <span class="text-xs font-semibold text-slate-600 uppercase tracking-wide">Meine Auswahl</span>
            <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{activeCount}/{selectedLectures.length}</span>
            <button
                onclick={() => expanded = false}
                class="ml-auto text-slate-400 hover:text-slate-600 text-sm"
                title="Einklappen"
            >✕</button>
        </div>
        <div class="flex-1 overflow-y-auto bg-slate-50">
            {#if selectedLectures.length === 0}
                <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-xs px-4 text-center gap-2">
                    <span class="text-2xl">📋</span>
                    Noch keine Vorlesungen ausgewählt.
                </div>
            {:else}
                {#each selectedLectures as sel (sel.catalog.unibas_id)}
                    <div
                        role="button"
                        tabindex="0"
                        onclick={() => onSelect?.(sel.catalog)}
                        onkeydown={(e) => e.key === 'Enter' && onSelect?.(sel.catalog)}
                        class="group relative flex w-full items-start gap-2 border-b border-slate-200 px-3 py-2.5 text-left transition-colors {onSelect ? 'cursor-pointer hover:bg-indigo-50' : ''} {!sel.active ? 'opacity-40' : ''}"
                    >
                        <input
                            type="checkbox"
                            checked={sel.active}
                            onclick={(e) => handleToggleActive(sel.catalog.unibas_id, e)}
                            class="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-600 cursor-pointer"
                            title="Im Kalender anzeigen / bei Module & KP berücksichtigen"
                        />
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                {#if sel.catalog.type_label}
                                    <span class="shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-semibold text-indigo-600 uppercase tracking-wide">
                                        {sel.catalog.type_label}
                                    </span>
                                {/if}
                                <p class="text-sm font-medium text-slate-800 truncate" title={sel.catalog.title}>{sel.catalog.title}</p>
                            </div>
                            {#if sel.catalog.course_number}
                                <p class="text-xs text-slate-500">{sel.catalog.course_number}</p>
                            {/if}
                        </div>
                        {#if sel.catalog.credits}
                            <span class="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                {sel.catalog.credits} KP
                            </span>
                        {/if}
                        <div class="flex flex-col gap-1 shrink-0">
                            <button
                                onclick={(e) => handleRemove(sel.catalog.unibas_id, e)}
                                class="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold transition-opacity hover:bg-red-200"
                                title="Entfernen"
                            >−</button>
                            <button
                                onclick={(e) => handleOpenDetails(sel.catalog.unibas_id, e)}
                                class="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold transition-opacity hover:bg-indigo-200"
                                title="Im Details-Tab öffnen"
                            >→</button>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
{:else}
    <button
        onclick={() => expanded = true}
        class="flex shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-slate-50 px-2 py-4 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title="Meine Auswahl anzeigen"
    >
        <span class="text-sm">☰</span>
        <span class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{activeCount}</span>
        <span class="text-[10px] font-semibold uppercase tracking-wide" style="writing-mode: vertical-rl;">Auswahl</span>
    </button>
{/if}
