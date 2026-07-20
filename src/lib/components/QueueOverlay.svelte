<script lang="ts">
    // Overlay for the import queue: shown as a modal from the "Warteschlange"
    // button in ImportView. Visualizes pending/running/paused imports,
    // supports removing individual items and reordering via up/down move
    // buttons (drag-and-drop would be nicer, but move buttons cover the
    // same need with far less code and work identically on touch).
    //
    // Reordering and removal are entirely server-driven: this component
    // just sends the user's intent (new order / which id to remove) and
    // re-fetches afterwards via `onchange`. The server (importQueue.ts)
    // owns the actual pairing rule — catalogue always directly before its
    // paired "all lectures" import, both moved/removed together — so this
    // component doesn't need to duplicate that logic; it just reflects
    // whatever comes back.
    import { availableSemesters, getLabel } from '$lib/stores/semester.svelte';
    import { t } from '$lib/i18n/translations';

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

    function moveUp(index: number) {
        if (index <= 0) return;
        const copy = [...queueItems];
        [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
        reorder(copy);
    }

    function moveDown(index: number) {
        if (index >= queueItems.length - 1) return;
        const copy = [...queueItems];
        [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
        reorder(copy);
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

        <div class="flex-1 overflow-y-auto p-3">
            {#if queueItems.length === 0}
                <p class="p-4 text-center text-sm text-slate-400">{t('Warteschlange leer.')}</p>
            {:else}
                <ul class="flex flex-col gap-2">
                    {#each queueItems as item, index (item.id)}
                        <li class="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                            <div class="flex flex-col gap-0.5">
                                <button
                                    disabled={busy || index === 0}
                                    onclick={() => moveUp(index)}
                                    class="text-slate-400 hover:text-slate-700 disabled:opacity-20"
                                    title={t('Nach oben')}
                                >▲</button>
                                <button
                                    disabled={busy || index === queueItems.length - 1}
                                    onclick={() => moveDown(index)}
                                    class="text-slate-400 hover:text-slate-700 disabled:opacity-20"
                                    title={t('Nach unten')}
                                >▼</button>
                            </div>

                            <div class="flex-1 min-w-0">
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

                            <span class="rounded-full px-2 py-0.5 text-xs font-medium {statusColor(item)}">{statusLabel(item)}</span>

                            <button
                                disabled={busy}
                                onclick={() => removeItem(item.id)}
                                class="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                title={t('Entfernen')}
                            >🗑</button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    </div>
</div>
