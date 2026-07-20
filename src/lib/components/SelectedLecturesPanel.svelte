<script lang="ts">
    import { selectedLectures, removeLecture, toggleActive, reorderLectures } from '$lib/stores/selectedLectures.svelte';
    import { goToDetails, nav, setSelectedPanelExpanded } from '$lib/stores/navigation.svelte';
    import { activeSemester } from '$lib/stores/semester.svelte';
    import type { CatalogEntry } from '$lib/types/lecture';
    import { t } from '$lib/i18n/translations';

    interface Props {
        onSelect?: (catalog: CatalogEntry) => void;
    }
    let { onSelect }: Props = $props();

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

    let copied = $state(false);
    let search = $state('');

    // Drag-and-drop reordering. Only enabled while unfiltered, since the
    // filtered list's order doesn't map 1:1 onto the underlying selection order.
    let draggedId = $state<number | null>(null);
    let dragOverId = $state<number | null>(null);

    function handleDragStart(unibasId: number | null, e: DragEvent) {
        if (unibasId === null) return;
        draggedId = unibasId;
        e.dataTransfer?.setData('text/plain', String(unibasId));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragOver(unibasId: number | null, e: DragEvent) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        dragOverId = unibasId;
    }

    function handleDrop(unibasId: number | null, e: DragEvent) {
        e.preventDefault();
        reorderLectures(draggedId, unibasId);
        draggedId = null;
        dragOverId = null;
    }

    function handleDragEnd() {
        draggedId = null;
        dragOverId = null;
    }

    const filteredLectures = $derived(
        selectedLectures.filter(s => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return s.catalog.title.toLowerCase().includes(q)
                || (s.catalog.course_number ?? '').toLowerCase().includes(q);
        })
    );

    async function handleCopyIds() {
        const ids = selectedLectures
            .map(s => s.catalog.course_number)
            .filter((cn): cn is string => !!cn)
            .join('\n\n');
        try {
            await navigator.clipboard.writeText(ids);
            copied = true;
            setTimeout(() => copied = false, 1500);
        } catch {
            // clipboard access denied — silently ignore
        }
    }

    function handleOpenVvz(unibasId: number | null, e: MouseEvent) {
        e.stopPropagation();
        if (unibasId !== null) {
            window.open(lectureVvzUrl(unibasId, activeSemester.lang === 'en' ? 'en' : 'de'), '_blank', 'noopener,noreferrer');
        }
    }

    function lectureVvzUrl(unibasId: number, lang: 'de' | 'en'): string {
        const path = lang === 'de' ? 'de/vorlesungsverzeichnis' : 'en/course-directory';
        return `https://vorlesungsverzeichnis.unibas.ch/${path}?id=${unibasId}`;
    }

    function handleOpenAllInVvz() {
        const ids = selectedLectures.map(s => s.catalog.unibas_id).filter((id): id is number => id !== null);
        const lang = activeSemester.lang === 'en' ? 'en' : 'de';
        for (const id of ids) {
            window.open(lectureVvzUrl(id, lang), '_blank', 'noopener,noreferrer');
        }
    }
</script>

{#if nav.selectedPanelExpanded}
    <div class="flex flex-col w-72 shrink-0 border-l border-slate-200">
        <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-2 bg-slate-50">
            <span class="text-xs font-semibold text-slate-600 uppercase tracking-wide">{t('Meine Auswahl')}</span>
            <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{activeCount}/{selectedLectures.length}</span>
            <button
                onclick={handleCopyIds}
                disabled={selectedLectures.length === 0}
                class="ml-auto text-slate-400 hover:text-slate-600 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                title={t("Vorlesungs-IDs kopieren")}
            >{copied ? '✓' : '⧉'}</button>
            <button
                onclick={handleOpenAllInVvz}
                disabled={selectedLectures.length === 0}
                class="text-slate-400 hover:text-slate-600 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                title={t("Alle im Vorlesungsverzeichnis öffnen")}
            >↗</button>
            <button
                onclick={() => setSelectedPanelExpanded(false)}
                class="text-slate-400 hover:text-slate-600 text-sm"
                title={t("Einklappen")}
            >✕</button>
        </div>
        <div class="flex items-center gap-2 border-b border-slate-200 px-3 py-2 bg-white">
            <div class="relative flex-1">
                <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                <input
                    bind:value={search}
                    placeholder={t("Suchen...")}
                    class="w-full rounded-lg border border-slate-200 pl-7 pr-2 py-1 text-xs focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                />
            </div>
        </div>
        <div class="flex-1 overflow-y-auto bg-slate-50">
            {#if selectedLectures.length === 0}
                <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-xs px-4 text-center gap-2">
                    <span class="text-2xl">📋</span>
                    {t('Noch keine Vorlesungen ausgewählt.')}
                </div>
            {:else if filteredLectures.length === 0}
                <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-xs px-4 text-center gap-2">
                    {t('Keine Treffer.')}
                </div>
            {:else}
                {@const canDrag = search.trim() === ''}
                {#each filteredLectures as sel (sel.catalog.unibas_id)}
                    <div
                        role="button"
                        tabindex="0"
                        onclick={() => onSelect?.(sel.catalog)}
                        onkeydown={(e) => e.key === 'Enter' && onSelect?.(sel.catalog)}
                        ondragover={(e) => canDrag && handleDragOver(sel.catalog.unibas_id, e)}
                        ondrop={(e) => canDrag && handleDrop(sel.catalog.unibas_id, e)}
                        class="group relative grid w-full items-center gap-x-2 gap-y-0.5 border-b border-slate-200 px-3 py-2.5 text-left transition-colors {onSelect ? 'cursor-pointer hover:bg-indigo-50' : ''} {!sel.active ? 'opacity-40' : ''} {dragOverId === sel.catalog.unibas_id && draggedId !== sel.catalog.unibas_id ? 'bg-indigo-100' : ''}"
                        style="grid-template-columns: auto 1fr auto auto auto;"
                    >
                        <!-- row 1: drag-handle | vorlesungstyp | kp | pfeil-oben | pfeil-rechts -->
                        {#if canDrag}
                            <button
                                draggable="true"
                                ondragstart={(e) => handleDragStart(sel.catalog.unibas_id, e)}
                                ondragend={handleDragEnd}
                                onclick={(e) => e.stopPropagation()}
                                class="opacity-0 group-hover:opacity-100 justify-self-center flex h-4 w-4 items-center justify-center text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing transition-opacity"
                                title={t("Ziehen zum Umsortieren")}
                            >
                                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect y="2" width="16" height="1.6" rx="0.8" fill="currentColor" />
                                    <rect y="7.2" width="16" height="1.6" rx="0.8" fill="currentColor" />
                                    <rect y="12.4" width="16" height="1.6" rx="0.8" fill="currentColor" />
                                </svg>
                            </button>
                        {:else}
                            <div></div>
                        {/if}
                        <div class="min-w-0">
                            {#if sel.catalog.type_label}
                                <span class="shrink-0 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-semibold text-indigo-600 uppercase tracking-wide">
                                    {sel.catalog.type_label}
                                </span>
                            {/if}
                        </div>
                        {#if sel.catalog.credits}
                            <span class="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                {sel.catalog.credits} {t('KP')}
                            </span>
                        {:else}
                            <div></div>
                        {/if}
                        <button
                            onclick={(e) => handleOpenVvz(sel.catalog.unibas_id, e)}
                            class="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xs transition-opacity hover:bg-slate-200 hover:text-slate-700"
                            title={t("Im Vorlesungsverzeichnis öffnen")}
                        >↗</button>
                        <button
                            onclick={(e) => handleOpenDetails(sel.catalog.unibas_id, e)}
                            class="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xs font-bold transition-opacity hover:bg-indigo-200"
                            title={t("Im Details-Tab öffnen")}
                        >→</button>

                        <!-- row 2: checkbox | titel (spans rest) -->
                        <input
                            type="checkbox"
                            checked={sel.active}
                            onclick={(e) => handleToggleActive(sel.catalog.unibas_id, e)}
                            class="h-4 w-4 shrink-0 justify-self-center rounded border-slate-300 accent-indigo-600 cursor-pointer"
                            title={t("Im Kalender anzeigen / bei Module & KP berücksichtigen")}
                        />
                        <p class="text-sm font-medium text-slate-800 truncate col-span-4" title={sel.catalog.title}>{sel.catalog.title}</p>

                        <!-- row 3: minus | vorlesungs-id (spans rest) -->
                        <button
                            onclick={(e) => handleRemove(sel.catalog.unibas_id, e)}
                            class="opacity-0 group-hover:opacity-100 justify-self-center flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold transition-opacity hover:bg-red-200"
                            title={t("Entfernen")}
                        >−</button>
                        {#if sel.catalog.course_number}
                            <p class="text-xs text-slate-500 col-span-4">{sel.catalog.course_number}</p>
                        {:else}
                            <div class="col-span-4"></div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    </div>
{:else}
    <button
        onclick={() => setSelectedPanelExpanded(true)}
        class="flex shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-slate-50 px-2 py-4 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title={t("Meine Auswahl anzeigen")}
    >
        <span class="text-sm">☰</span>
        <span class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{activeCount}</span>
        <span class="text-[10px] font-semibold uppercase tracking-wide" style="writing-mode: vertical-rl;">{t('Auswahl')}</span>
    </button>
{/if}
