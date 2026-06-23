<script lang="ts">
    import ImportView from '$lib/components/ImportView.svelte';
    import LectureView from '$lib/components/LectureView.svelte';
    import CalendarView from '$lib/components/CalendarView.svelte';
    import ModuleView from '$lib/components/ModuleView.svelte';
    import { selectedLectures } from '$lib/stores/selectedLectures.svelte';

    type Tab = 'import' | 'lectures' | 'calendar' | 'modules';
    let activeTab = $state<Tab>('lectures');

    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: 'import', label: 'Import', icon: '⬇' },
        { id: 'lectures', label: 'Kursauswahl', icon: '📚' },
        { id: 'calendar', label: 'Kalender', icon: '📅' },
        { id: 'modules', label: 'Module & KP', icon: '🎓' },
    ];
</script>

<div class="flex h-screen flex-col bg-slate-100">
    <!-- Top navigation bar -->
    <header class="flex items-center gap-0 border-b border-slate-200 bg-white shadow-sm px-6">
        <div class="mr-6 flex items-center gap-2 py-3">
            <span class="text-lg font-bold text-indigo-600 tracking-tight">Vorlesungsplaner</span>
            <span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-500 font-medium">UniBasel</span>
        </div>
        <nav class="flex h-full">
            {#each tabs as tab}
                <button
                    onclick={() => activeTab = tab.id}
                    class="relative flex items-center gap-2 px-5 py-4 text-sm font-medium transition-colors
                        {activeTab === tab.id
                            ? 'text-indigo-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-600'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}"
                >
                    <span class="text-base">{tab.icon}</span>
                    {tab.label}
                    {#if tab.id === 'lectures' && selectedLectures.length > 0}
                        <span class="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                            {selectedLectures.length}
                        </span>
                    {/if}
                </button>
            {/each}
        </nav>
    </header>

    <!-- Main content -->
    <main class="flex flex-1 min-h-0 overflow-hidden">
        <div class="flex-1 min-h-0 overflow-hidden bg-white">
            {#if activeTab === 'import'}
                <ImportView />
            {:else if activeTab === 'lectures'}
                <LectureView />
            {:else if activeTab === 'calendar'}
                <CalendarView />
            {:else if activeTab === 'modules'}
                <ModuleView />
            {/if}
        </div>
    </main>
</div>
