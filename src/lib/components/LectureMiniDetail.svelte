<script lang="ts">
    import { goToDetails } from '$lib/stores/navigation.svelte';
    import type { LectureDetail } from '$lib/types/lecture';

    interface Props {
        detail: LectureDetail | null;
        onClose: () => void;
    }
    let { detail, onClose }: Props = $props();
</script>

{#if detail}
    <div class="border-t border-slate-200 bg-slate-50 p-5 overflow-y-auto max-h-72">
        <div class="flex items-start justify-between gap-4">
            <div>
                <h3 class="text-base font-semibold text-slate-900">{detail.title}</h3>
                {#if detail.course_number}
                    <p class="text-xs text-slate-500 mt-0.5">{detail.course_number}</p>
                {/if}
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button
                    onclick={() => detail?.unibas_id && goToDetails(detail.unibas_id)}
                    class="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 shadow-sm transition-colors hover:bg-indigo-50"
                >
                    Weiteres <span aria-hidden="true">→</span>
                </button>
                <button
                    onclick={onClose}
                    class="text-slate-400 hover:text-slate-600 text-lg leading-none"
                >×</button>
            </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm lg:grid-cols-4">
            {#if detail.semester}
                <div><span class="text-xs text-slate-500 block">Semester</span>{detail.semester}</div>
            {/if}
            {#if detail.language}
                <div><span class="text-xs text-slate-500 block">Sprache</span>{detail.language}</div>
            {/if}
            {#if detail.faculty}
                <div><span class="text-xs text-slate-500 block">Fakultät</span>{detail.faculty}</div>
            {/if}
            {#if detail.offered_by}
                <div><span class="text-xs text-slate-500 block">Angeboten von</span>{detail.offered_by}</div>
            {/if}
            {#if detail.lecturers}
                <div class="col-span-2"><span class="text-xs text-slate-500 block">Dozierende</span>{detail.lecturers}</div>
            {/if}
            {#if detail.assessment_format}
                <div class="col-span-2"><span class="text-xs text-slate-500 block">Prüfungsform</span>{detail.assessment_format}</div>
            {/if}
        </div>
        {#if detail.recurringTimes?.length > 0}
            <div class="mt-3">
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Regelmässigkeit</p>
                <div class="flex flex-wrap gap-2">
                    {#each detail.recurringTimes as rt}
                        <span class="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-1 text-xs text-indigo-700 font-medium">
                            {rt.frequency ? `${rt.frequency} ` : ''}{rt.weekday} {rt.start_time}–{rt.end_time}
                        </span>
                    {/each}
                </div>
            </div>
        {/if}
        {#if detail.content}
            <div class="mt-3">
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Beschreibung</p>
                <p class="text-sm text-slate-700 leading-relaxed line-clamp-4 whitespace-pre-line">{detail.content}</p>
            </div>
        {:else}
            <div class="mt-3">
                <p class="text-xs text-slate-400">Keine Beschreibung verfügbar — führe "Import All Lectures" aus, um Details zu laden.</p>
            </div>
        {/if}
    </div>
{/if}
