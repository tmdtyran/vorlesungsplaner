<script lang="ts">
    import ImportView from '$lib/components/ImportView.svelte';
    import LectureView from '$lib/components/LectureView.svelte';
    import DetailsView from '$lib/components/DetailsView.svelte';
    import CalendarView from '$lib/components/CalendarView.svelte';
    import ModuleView from '$lib/components/ModuleView.svelte';
    import { selectedLectures, loadSelectionsForSemester } from '$lib/stores/selectedLectures.svelte';
    import { activeSemester, availableSemesters, setActiveSemester, getLabel, type SemesterOption } from '$lib/stores/semester.svelte';
    import { nav, setActiveTab, type Tab } from '$lib/stores/navigation.svelte';

    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: 'import',    label: 'Import',      icon: '⬇' },
        { id: 'lectures',  label: 'Kursauswahl', icon: '📚' },
        { id: 'details',   label: 'Details',     icon: '📄' },
        { id: 'calendar',  label: 'Kalender',    icon: '📅' },
        { id: 'modules',   label: 'Module & KP', icon: '🎓' },
    ];

    // Load cached semester list on mount
    $effect(() => {
        if (availableSemesters.length === 0) {
            fetch('/api/semesters')
                .then(r => r.json())
                .then((data: SemesterOption[]) => {
                    if (Array.isArray(data) && data.length > 0) {
                        availableSemesters.splice(0, availableSemesters.length, ...data);
                        // Set active to first if still default
                        if (activeSemester.periodeId === 'default') {
                            setActiveSemester(data[0].periodeId, activeSemester.lang);
                        }
                    }
                })
                .catch(() => {});
        }
    });

    // Central selection loading: runs once per periodeId/lang change and is
    // shared by all tabs (Kursauswahl, Kalender, Module & KP), so the
    // top-right semester/language switcher affects every view consistently.
    // Selections are persisted (localStorage) and scoped per semester.
    $effect(() => {
        const periodeId = activeSemester.periodeId;
        const lang = activeSemester.lang;
        if (periodeId && periodeId !== 'default') {
            loadSelectionsForSemester(periodeId, lang);
        }
    });

    const activeLabel = $derived(
        availableSemesters.length > 0
            ? getLabel(availableSemesters.find(s => s.periodeId === activeSemester.periodeId) ?? availableSemesters[0], activeSemester.lang)
            : activeSemester.periodeId === 'default' ? '— kein Semester —' : activeSemester.periodeId
    );
</script>

<div class="flex h-screen flex-col bg-slate-100">
    <!-- Top navigation bar -->
    <header class="flex items-center gap-0 border-b border-slate-200 bg-white shadow-sm px-4">
        <!-- Logo -->
        <div class="mr-5 flex items-center gap-2 py-3 shrink-0">
            <span class="text-lg font-bold text-indigo-600 tracking-tight">Vorlesungsplaner</span>
            <span class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-500 font-medium">UniBasel</span>
        </div>

        <!-- Tabs -->
        <nav class="flex h-full">
            {#each tabs as tab}
                <button
                    onclick={() => setActiveTab(tab.id)}
                    class="relative flex items-center gap-2 px-4 py-4 text-sm font-medium transition-colors
                        {nav.activeTab === tab.id
                            ? 'text-indigo-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-600'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}"
                >
                    <span>{tab.icon}</span>
                    {tab.label}
                    {#if tab.id === 'lectures' && selectedLectures.length > 0}
                        <span class="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                            {selectedLectures.length}
                        </span>
                    {/if}
                </button>
            {/each}
        </nav>

        <!-- Semester & Language selector (top-right) -->
        <div class="ml-auto flex items-center gap-2 shrink-0">
            <span class="text-xs text-slate-400 hidden sm:block">Aktiv:</span>

            {#if availableSemesters.length > 0}
                <select
                    value={activeSemester.periodeId}
                    onchange={(e) => setActiveSemester((e.target as HTMLSelectElement).value, activeSemester.lang)}
                    class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                >
                    {#each availableSemesters as s}
                        <option value={s.periodeId}>
                            {activeSemester.lang === 'de' ? s.label_de : s.label_en}
                        </option>
                    {/each}
                </select>
            {:else}
                <span class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
                    — Import → Fetch Semesters —
                </span>
            {/if}

            <select
                value={activeSemester.lang}
                onchange={(e) => setActiveSemester(activeSemester.periodeId, (e.target as HTMLSelectElement).value)}
                class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
                <option value="de">DE</option>
                <option value="en">EN</option>
            </select>
        </div>
    </header>

    <!-- Main content -->
    <main class="flex flex-1 min-h-0 overflow-hidden">
        <div class="flex-1 min-h-0 overflow-hidden bg-white">
            {#if nav.activeTab === 'import'}
                <ImportView />
            {:else if nav.activeTab === 'lectures'}
                <LectureView />
            {:else if nav.activeTab === 'details'}
                <DetailsView />
            {:else if nav.activeTab === 'calendar'}
                <CalendarView />
            {:else if nav.activeTab === 'modules'}
                <ModuleView />
            {/if}
        </div>
    </main>
</div>
