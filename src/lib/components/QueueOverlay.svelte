<script lang="ts">
    // Overlay for the import queue: shown as a modal from the "Warteschlange"
    // button in ImportView. Visualizes pending/running/paused imports and
    // supports removing individual items and reordering via drag-and-drop —
    // same pointer-events + "ghost row" pattern as SelectedLecturesPanel's
    // drag-and-drop (see there for the general approach): the real row stays
    // in the flow (invisible while dragging) so svelte/animate flip can
    // smoothly reflow siblings around it, while a separate absolutely
    // positioned floating copy follows the pointer directly.
    //
    // Pairing rule (catalogue always directly before its paired "all
    // lectures" import, both moved together) is enforced live, client-side,
    // during the drag itself via normalizePairs() — not just after the
    // server round-trip — so a catalogue item can never visually end up
    // below its own lectures item (or vice versa) even for a split second.
    // reorderQueue() on the server applies the exact same rule as the
    // source of truth; the client-side copy here is purely for drag
    // responsiveness.
    import { availableSemesters, getLabel } from '$lib/stores/semester.svelte';
    import { t } from '$lib/i18n/translations';
    import { flip } from 'svelte/animate';
    import { untrack } from 'svelte';

    interface QueueItem {
        id: string;
        action: 'catalogue' | 'lectures';
        periodeId: string;
        lang: string;
        status: 'queued' | 'running' | 'paused' | 'error';
        addedAt: string;
        progress?: { processedIds: number[]; success: number; failed: number };
        error?: string | null;
    }

    let { queueItems, queuePaused, onclose, onchange }: {
        queueItems: QueueItem[];
        queuePaused: boolean;
        onclose: () => void;
        onchange: () => void;
    } = $props();

    let busy = $state(false);

    // Local working copy so drag reordering feels instant instead of
    // waiting on a server round-trip + re-poll for every intermediate
    // position. Order is intentionally "sticky": once dragged locally, it's
    // kept even as fresh polls come in — only content (status/progress/
    // error) is merged in from the latest prop, and items are added/removed
    // to match. Without this, the moment the drag ends the next poll tick
    // would briefly reflect the still-old server order before the reorder
    // request's response arrives, producing a visible snap-back-then-jump.
    let items = $state<QueueItem[]>([...queueItems]);
    $effect(() => {
        if (draggedId !== null) return;
        const byId = new Map(queueItems.map(i => [i.id, i]));
        const merged: QueueItem[] = [];
        for (const local of untrack(() => items)) {
            const fresh = byId.get(local.id);
            if (fresh) {
                merged.push(fresh);
                byId.delete(local.id);
            }
        }
        for (const added of byId.values()) merged.push(added); // new items from elsewhere — appended
        items = merged;
    });

    function findPair(list: QueueItem[], item: QueueItem): QueueItem | undefined {
        const otherAction = item.action === 'catalogue' ? 'lectures' : 'catalogue';
        return list.find(i => i.action === otherAction && i.periodeId === item.periodeId && i.lang === item.lang);
    }

    /** Client-side mirror of importQueue.ts's reorderQueue() pairing rule:
     *  a catalogue import and its paired "all lectures" import always travel
     *  together, catalogue first — whichever of the two was actually moved,
     *  pull its partner to sit directly after the catalogue item. */
    function normalizePairs(list: QueueItem[]): QueueItem[] {
        const result = [...list];
        for (const item of result) {
            if (item.action !== 'catalogue') continue;
            const pair = findPair(result, item);
            if (!pair) continue;
            const catIdx = result.indexOf(item);
            if (result[catIdx + 1] === pair) continue;
            result.splice(result.indexOf(pair), 1);
            result.splice(result.indexOf(item) + 1, 0, pair);
        }
        return result;
    }

    let listEl = $state<HTMLDivElement | undefined>(undefined);
    let draggedId = $state<string | null>(null);
    let draggedItem = $state<QueueItem | null>(null);
    let dragOffsetY = $state(0);
    let dragStartRect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
    let pointerStartY = 0;
    let lastEvaluatedTarget: string | null | undefined = undefined;
    let orderChangedDuringDrag = false;

    function rowEl(id: string): HTMLElement | null {
        return listEl?.querySelector(`[data-queue-id="${id}"]`) ?? null;
    }

    function handlePointerDown(item: QueueItem, e: PointerEvent) {
        if (!listEl) return;
        e.preventDefault();
        const el = rowEl(item.id);
        if (!el) return;
        const rowRect = el.getBoundingClientRect();
        const listRect = listEl.getBoundingClientRect();
        dragStartRect = {
            top: rowRect.top - listRect.top + listEl.scrollTop,
            left: rowRect.left - listRect.left,
            width: rowRect.width,
            height: rowRect.height
        };
        draggedId = item.id;
        draggedItem = item;
        dragOffsetY = 0;
        pointerStartY = e.clientY;
        lastEvaluatedTarget = undefined;
        orderChangedDuringDrag = false;
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    }

    function handlePointerMove(e: PointerEvent) {
        if (draggedId === null) return;
        dragOffsetY = e.clientY - pointerStartY;

        // Find the first item (in current order) whose vertical midpoint the
        // cursor is still above — the dragged row should end up right before it.
        let target: string | null = null;
        for (const item of items) {
            if (item.id === draggedId) continue;
            const el = rowEl(item.id);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) {
                target = item.id;
                break;
            }
        }

        if (target !== lastEvaluatedTarget) {
            lastEvaluatedTarget = target;

            const fromIdx = items.findIndex(i => i.id === draggedId);
            if (fromIdx === -1) return;
            const next = [...items];
            const [moved] = next.splice(fromIdx, 1);
            if (target === null) {
                next.push(moved);
            } else {
                const toIdx = next.findIndex(i => i.id === target);
                next.splice(toIdx === -1 ? next.length : toIdx, 0, moved);
            }
            items = normalizePairs(next);
            orderChangedDuringDrag = true;
        }
    }

    async function handlePointerUp() {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        const changed = orderChangedDuringDrag;
        const finalOrder = items;
        draggedId = null;
        draggedItem = null;
        dragOffsetY = 0;
        dragStartRect = null;
        lastEvaluatedTarget = undefined;
        if (changed) await reorder(finalOrder);
    }

    function semesterLabel(periodeId: string, lang: string): string {
        const s = availableSemesters.find(s => s.periodeId === periodeId);
        return s ? getLabel(s, lang) : periodeId;
    }

    function actionLabel(action: 'catalogue' | 'lectures'): string {
        return action === 'catalogue' ? t('Katalog') : t('Alle Vorlesungen');
    }

    function statusLabel(item: QueueItem): string {
        switch (item.status) {
            case 'running': return t('läuft');
            case 'paused': return t('pausiert');
            case 'error': return t('Fehler');
            default: return t('wartet');
        }
    }

    function statusColor(item: QueueItem): string {
        switch (item.status) {
            case 'running': return 'bg-amber-100 text-amber-700';
            case 'paused': return 'bg-slate-200 text-slate-600';
            case 'error': return 'bg-red-100 text-red-700';
            default: return 'bg-indigo-100 text-indigo-700';
        }
    }

    async function removeItem(id: string) {
        busy = true;
        try {
            await fetch('/api/import/queue/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            onchange();
        } finally {
            busy = false;
        }
    }

    async function reorder(newOrder: QueueItem[]) {
        busy = true;
        try {
            await fetch('/api/import/queue/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderedIds: newOrder.map(i => i.id) })
            });
            onchange();
        } finally {
            busy = false;
        }
    }

    async function togglePause() {
        busy = true;
        try {
            await fetch(`/api/import/queue/${queuePaused ? 'resume' : 'pause'}`, { method: 'POST' });
            onchange();
        } finally {
            busy = false;
        }
    }

    function progressText(item: QueueItem): string | null {
        if (item.action !== 'lectures' || !item.progress) return null;
        return `${item.progress.processedIds.length} (${item.progress.success}✓ / ${item.progress.failed}✗)`;
    }
</script>

{#snippet rowInner(item: QueueItem, showHandle: boolean)}
    {#if showHandle}
        <button
            onpointerdown={(e) => handlePointerDown(item, e)}
            onclick={(e) => e.stopPropagation()}
            class="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400 hover:text-slate-600 cursor-grab active:cursor-grabbing touch-none"
            title={t('Ziehen zum Umsortieren')}
        >
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect y="2" width="16" height="1.6" rx="0.8" fill="currentColor" />
                <rect y="7.2" width="16" height="1.6" rx="0.8" fill="currentColor" />
                <rect y="12.4" width="16" height="1.6" rx="0.8" fill="currentColor" />
            </svg>
        </button>
    {:else}
        <div class="w-4 shrink-0"></div>
    {/if}

    <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium text-slate-800">{semesterLabel(item.periodeId, item.lang)}</span>
            <span class="text-xs text-slate-400 uppercase">{item.lang}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-500">
            <span>{actionLabel(item.action)}</span>
            {#if progressText(item)}
                <span class="text-slate-400">· {progressText(item)}</span>
            {/if}
            {#if item.status === 'error' && item.error}
                <span class="truncate text-red-500" title={item.error}>· {item.error}</span>
            {/if}
        </div>
    </div>

    <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item)}">{statusLabel(item)}</span>

    <button
        onpointerdown={(e) => e.stopPropagation()}
        onclick={() => removeItem(item.id)}
        disabled={busy}
        class="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        title={t('Entfernen')}
    >🗑</button>
{/snippet}

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onclick={onclose} role="presentation">
    <div
        class="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
    >
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 class="text-sm font-semibold text-slate-800">{t('Warteschlange')}</h2>
            <div class="flex items-center gap-2">
                <button
                    disabled={busy}
                    onclick={togglePause}
                    class="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    {queuePaused ? `▶ ${t('Fortsetzen')}` : `⏸ ${t('Pausieren')}`}
                </button>
                <button onclick={onclose} class="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">✕</button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-3 relative" bind:this={listEl}>
            {#if items.length === 0}
                <p class="p-4 text-center text-sm text-slate-400">{t('Warteschlange leer.')}</p>
            {:else}
                <div class="flex flex-col gap-2">
                    {#each items as item (item.id)}
                        {@const isDragged = item.id === draggedId}
                        <div
                            data-queue-id={item.id}
                            animate:flip={{ duration: 200 }}
                            style={isDragged && dragStartRect ? `height: ${dragStartRect.height}px;` : ''}
                            class={isDragged ? '' : 'group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2'}
                        >
                            {#if !isDragged}
                                {@render rowInner(item, items.length > 1)}
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}

            <!-- floating ghost copy of the dragged row — follows the pointer directly -->
            {#if draggedId !== null && draggedItem && dragStartRect}
                <div
                    class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg pointer-events-none"
                    style="position: absolute; top: {dragStartRect.top + dragOffsetY}px; left: {dragStartRect.left}px; width: {dragStartRect.width}px; z-index: 20;"
                >
                    {@render rowInner(draggedItem, true)}
                </div>
            {/if}
        </div>
    </div>
</div>
