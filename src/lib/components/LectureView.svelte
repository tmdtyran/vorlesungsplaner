<script lang="ts">
    import type { CatalogEntry, LectureDetail } from '$lib/types/lecture';
    import { selectedLectures, addLecture, removeLecture, isSelected } from '$lib/stores/selectedLectures.svelte';
    import { activeSemester } from '$lib/stores/semester.svelte';

    let allLectures = $state<CatalogEntry[]>([]);
    let viewMode = $state<'flat' | 'hierarchy'>('flat');
    let searchLeft = $state('');
    let selectedDetail = $state<LectureDetail | null>(null);
    let selectedFromRight = $state(false);
    let loading = $state(false);

    // Hierarchy view: which folder nodes are expanded. Empty by default =
    // everything collapsed, only root-level nodes visible until expanded.
    let expandedKeys = $state<Set<number>>(new Set());

    function toggleExpand(key: number, e: MouseEvent) {
        e.stopPropagation();
        const next = new Set(expandedKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        expandedKeys = next;
    }

    function semesterParams(): string {
        return `periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`;
    }

    async function loadLectures() {
        loading = true;
        const mode = viewMode === 'hierarchy' ? 'hierarchy' : 'flat';
        const res = await fetch(`/api/lectures?mode=${mode}&${semesterParams()}`);
        allLectures = await res.json();
        loading = false;
    }

    $effect(() => {
        viewMode;
        activeSemester.periodeId;
        activeSemester.lang;
        expandedKeys = new Set();
        loadLectures();
    });

    async function fetchDetail(lecture: CatalogEntry): Promise<LectureDetail | null> {
        if (!lecture.unibas_id) return null;
        try {
            const res = await fetch(`/api/lectures/${lecture.unibas_id}?${semesterParams()}`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    async function selectLecture(lecture: CatalogEntry, fromRight = false) {
        selectedFromRight = fromRight;
        const detail = await fetchDetail(lecture);
        selectedDetail = detail;
    }

    async function handleAdd(lecture: CatalogEntry, e: MouseEvent) {
        e.stopPropagation();
        const detail = await fetchDetail(lecture);
        addLecture(lecture, detail);
    }

    function handleRemove(unibasId: number | null, e: MouseEvent) {
        e.stopPropagation();
        removeLecture(unibasId);
    }

    const filteredLeft = $derived(
        allLectures
            .filter(l => l.unibas_id !== null || viewMode === 'hierarchy')
            .filter(l => {
                if (!searchLeft) return true;
                const q = searchLeft.toLowerCase();
                return (
                    l.title.toLowerCase().includes(q) ||
                    (l.course_number ?? '').toLowerCase().includes(q) ||
                    (l.lecturer ?? '').toLowerCase().includes(q)
                );
            })
    );

    // Build a real parent/child tree from ALL rows (not the flat, arbitrarily
    // hierarchy_key-sorted list) and flatten it via depth-first traversal so
    // parents always render immediately before their children, with a
    // correctly computed indentation depth.
    function buildTree(rows: CatalogEntry[]) {
        const byKey = new Map<number, CatalogEntry & { children: any[] }>();
        for (const l of rows) {
            const key = l.hierarchy_key ?? l.id;
            byKey.set(key, { ...l, children: [] });
        }
        const roots: any[] = [];
        for (const node of byKey.values()) {
            if (node.parent_key !== null && node.parent_key !== undefined && byKey.has(node.parent_key)) {
                byKey.get(node.parent_key)!.children.push(node);
            } else {
                roots.push(node);
            }
        }
        function sortRec(nodes: any[]) {
            nodes.sort((a, b) => a.title.localeCompare(b.title));
            for (const n of nodes) sortRec(n.children);
        }
        sortRec(roots);
        return roots;
    }

    // Prune branches that don't match the search query, but keep ancestor
    // folders of any matching leaf so the path stays visible.
    function filterTree(nodes: any[], query: string): any[] {
        if (!query) return nodes;
        const q = query.toLowerCase();
        const result: any[] = [];
        for (const node of nodes) {
            const selfMatch =
                node.title.toLowerCase().includes(q) ||
                (node.course_number ?? '').toLowerCase().includes(q) ||
                (node.lecturer ?? '').toLowerCase().includes(q);
            const filteredChildren = filterTree(node.children ?? [], query);
            if (selfMatch || filteredChildren.length > 0) {
                result.push({ ...node, children: filteredChildren });
            }
        }
        return result;
    }

    function flattenTree(
        nodes: any[],
        expanded: Set<number>,
        forceExpandAll: boolean,
        depth = 0,
        out: any[] = []
    ): any[] {
        for (const node of nodes) {
            const key = node.hierarchy_key ?? node.id;
            const hasChildren = (node.children?.length ?? 0) > 0;
            const isExpanded = forceExpandAll || expanded.has(key);

            out.push({ ...node, depth, hasChildren, isExpanded });

            if (hasChildren && isExpanded) {
                flattenTree(node.children, expanded, forceExpandAll, depth + 1, out);
            }
        }
        return out;
    }

    const hierarchyFlatList = $derived(() => {
        if (viewMode !== 'hierarchy') return [];
        const roots = buildTree(allLectures);
        const filtered = filterTree(roots, searchLeft);
        // While actively searching, auto-expand everything so matches under
        // collapsed folders are visible; otherwise respect manual state.
        const forceExpandAll = searchLeft.trim().length > 0;
        return flattenTree(filtered, expandedKeys, forceExpandAll);
    });

    const weekdayMap: Record<string, string> = {
        'Mo': 'Montag', 'Di': 'Dienstag', 'Mi': 'Mittwoch',
        'Do': 'Donnerstag', 'Fr': 'Freitag', 'Sa': 'Samstag'
    };
</script>

<div class="flex h-full flex-col gap-0">
    <!-- Top bar -->
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-2 bg-white">
        <div class="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
                onclick={() => viewMode = 'flat'}
                class="px-3 py-1.5 text-xs font-medium transition-colors
                    {viewMode === 'flat' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
            >≡ Liste</button>
            <button
                onclick={() => viewMode = 'hierarchy'}
                class="px-3 py-1.5 text-xs font-medium transition-colors
                    {viewMode === 'hierarchy' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
            >⊞ Hierarchie</button>
        </div>
        <div class="relative flex-1 max-w-sm">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
            <input
                bind:value={searchLeft}
                placeholder="Vorlesungen suchen..."
                class="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-1.5 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            />
        </div>
        {#if loading}
            <span class="text-xs text-slate-400">Laden…</span>
        {:else}
            <span class="text-xs text-slate-400">
                {viewMode === 'hierarchy' ? hierarchyFlatList().length : filteredLeft.length} Vorlesungen
            </span>
        {/if}
    </div>

    <!-- Main content area -->
    <div class="flex flex-1 min-h-0">
        <!-- Left scroll box: All lectures -->
        <div class="flex flex-col flex-1 min-w-0 border-r border-slate-200">
            <div class="flex-1 overflow-y-auto">
                {#if loading}
                    <div class="flex items-center justify-center h-32 text-slate-400 text-sm">Lädt…</div>
                {:else if viewMode === 'hierarchy' ? hierarchyFlatList().length === 0 : filteredLeft.length === 0}
                    <div class="flex items-center justify-center h-32 text-slate-400 text-sm">Keine Vorlesungen gefunden</div>
                {:else if viewMode === 'flat'}
                    {#each filteredLeft as lecture}
                        {@const selected = isSelected(lecture.unibas_id)}
                        <div
                            role="button"
                            tabindex="0"
                            onclick={() => selectLecture(lecture, false)}
                            onkeydown={(e) => e.key === 'Enter' && selectLecture(lecture, false)}
                            class="group relative flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-indigo-50"
                        >
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    {#if lecture.type_label}
                                        <span class="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
                                            {lecture.type_label}
                                        </span>
                                    {/if}
                                    <p class="text-sm font-medium text-slate-800 truncate">{lecture.title}</p>
                                </div>
                                {#if lecture.course_number || lecture.lecturer}
                                    <p class="text-xs text-slate-500 truncate">
                                        {lecture.course_number ?? ''}{lecture.course_number && lecture.lecturer ? ' · ' : ''}{lecture.lecturer ?? ''}
                                    </p>
                                {/if}
                                {#if lecture.schedule}
                                    <p class="text-xs text-indigo-500 truncate">🕐 {lecture.schedule}</p>
                                {/if}
                            </div>
                            {#if lecture.credits}
                                <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                    {lecture.credits} KP
                                </span>
                            {/if}
                            {#if !selected}
                                <button
                                    onclick={(e) => handleAdd(lecture, e)}
                                    class="shrink-0 opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-bold transition-opacity hover:bg-indigo-700"
                                    title="Zur Liste hinzufügen"
                                >+</button>
                            {:else}
                                <span class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xs" title="Bereits ausgewählt">✓</span>
                            {/if}
                        </div>
                    {/each}
                {:else}
                    <!-- Hierarchy view: real tree, flattened via depth-first traversal -->
                    {#each hierarchyFlatList() as lecture}
                        {@const indent = (lecture.depth ?? 0) * 16}
                        {@const isLeaf = lecture.unibas_id !== null}
                        {@const selected = isSelected(lecture.unibas_id)}
                        {@const key = lecture.hierarchy_key ?? lecture.id}
                        <div
                            role="button"
                            tabindex="0"
                            onclick={(e) => isLeaf ? selectLecture(lecture, false) : (lecture.hasChildren && toggleExpand(key, e))}
                            onkeydown={(e) => { if (e.key === 'Enter') { isLeaf ? selectLecture(lecture, false) : (lecture.hasChildren && toggleExpand(key, e)); } }}
                            class="group relative flex w-full items-center gap-3 border-b border-slate-100 py-2.5 pr-4 text-left transition-colors
                                {isLeaf ? 'hover:bg-indigo-50 cursor-pointer' : 'cursor-pointer bg-slate-50 hover:bg-slate-100'}"
                            style="padding-left: {16 + indent}px"
                        >
                            {#if !isLeaf}
                                <span
                                    class="text-slate-400 text-xs mr-1 inline-block transition-transform duration-150 {lecture.hasChildren ? '' : 'opacity-0'}"
                                    style="transform: rotate({lecture.isExpanded ? 90 : 0}deg)"
                                >▶</span>
                            {/if}
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    {#if isLeaf && lecture.type_label}
                                        <span class="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
                                            {lecture.type_label}
                                        </span>
                                    {/if}
                                    <p class="text-sm truncate {isLeaf ? 'font-medium text-slate-800' : 'font-semibold text-slate-700'}">{lecture.title}</p>
                                </div>
                                {#if isLeaf && (lecture.course_number || lecture.lecturer)}
                                    <p class="text-xs text-slate-500 truncate">
                                        {lecture.course_number ?? ''}{lecture.course_number && lecture.lecturer ? ' · ' : ''}{lecture.lecturer ?? ''}
                                    </p>
                                {/if}
                                {#if isLeaf && lecture.schedule}
                                    <p class="text-xs text-indigo-500 truncate">🕐 {lecture.schedule}</p>
                                {/if}
                            </div>
                            {#if lecture.credits}
                                <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                                    {lecture.credits} KP
                                </span>
                            {/if}
                            {#if isLeaf && !selected}
                                <button
                                    onclick={(e) => handleAdd(lecture, e)}
                                    class="shrink-0 opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white text-sm font-bold transition-opacity hover:bg-indigo-700"
                                >+</button>
                            {:else if isLeaf && selected}
                                <span class="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xs">✓</span>
                            {/if}
                        </div>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- Right scroll box: Selected lectures -->
        <div class="flex flex-col w-72 shrink-0">
            <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-2 bg-slate-50">
                <span class="text-xs font-semibold text-slate-600 uppercase tracking-wide">Meine Auswahl</span>
                <span class="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{selectedLectures.length}</span>
            </div>
            <div class="flex-1 overflow-y-auto bg-slate-50">
                {#if selectedLectures.length === 0}
                    <div class="flex flex-col items-center justify-center h-32 text-slate-400 text-xs px-4 text-center gap-2">
                        <span class="text-2xl">📋</span>
                        Noch keine Vorlesungen ausgewählt. Klicke auf + um welche hinzuzufügen.
                    </div>
                {:else}
                    {#each selectedLectures as sel}
                        <div
                            role="button"
                            tabindex="0"
                            onclick={() => selectLecture(sel.catalog, true)}
                            onkeydown={(e) => e.key === 'Enter' && selectLecture(sel.catalog, true)}
                            class="group relative flex w-full cursor-pointer items-center gap-3 border-b border-slate-200 px-4 py-3 text-left transition-colors hover:bg-indigo-50"
                        >
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium text-slate-800 truncate">{sel.catalog.title}</p>
                                {#if sel.catalog.course_number}
                                    <p class="text-xs text-slate-500">{sel.catalog.course_number}</p>
                                {/if}
                            </div>
                            {#if sel.catalog.credits}
                                <span class="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                    {sel.catalog.credits} KP
                                </span>
                            {/if}
                            <button
                                onclick={(e) => handleRemove(sel.catalog.unibas_id, e)}
                                class="shrink-0 opacity-0 group-hover:opacity-100 flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 text-sm font-bold transition-opacity hover:bg-red-200"
                                title="Entfernen"
                            >−</button>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>

    <!-- Detail panel -->
    {#if selectedDetail}
        <div class="border-t border-slate-200 bg-slate-50 p-5 overflow-y-auto max-h-64">
            <div class="flex items-start justify-between gap-4">
                <div>
                    <h3 class="text-base font-semibold text-slate-900">{selectedDetail.title}</h3>
                    {#if selectedDetail.course_number}
                        <p class="text-xs text-slate-500 mt-0.5">{selectedDetail.course_number}</p>
                    {/if}
                </div>
                <button
                    onclick={() => selectedDetail = null}
                    class="text-slate-400 hover:text-slate-600 text-lg leading-none"
                >×</button>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm lg:grid-cols-4">
                {#if selectedDetail.semester}
                    <div><span class="text-xs text-slate-500 block">Semester</span>{selectedDetail.semester}</div>
                {/if}
                {#if selectedDetail.language}
                    <div><span class="text-xs text-slate-500 block">Sprache</span>{selectedDetail.language}</div>
                {/if}
                {#if selectedDetail.faculty}
                    <div><span class="text-xs text-slate-500 block">Fakultät</span>{selectedDetail.faculty}</div>
                {/if}
                {#if selectedDetail.offered_by}
                    <div><span class="text-xs text-slate-500 block">Angeboten von</span>{selectedDetail.offered_by}</div>
                {/if}
                {#if selectedDetail.lecturers}
                    <div class="col-span-2"><span class="text-xs text-slate-500 block">Dozierende</span>{selectedDetail.lecturers}</div>
                {/if}
                {#if selectedDetail.assessment_format}
                    <div class="col-span-2"><span class="text-xs text-slate-500 block">Prüfungsform</span>{selectedDetail.assessment_format}</div>
                {/if}
            </div>
            {#if selectedDetail.recurringTimes?.length > 0}
                <div class="mt-3">
                    <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Regelmässigkeit</p>
                    <div class="flex flex-wrap gap-2">
                        {#each selectedDetail.recurringTimes as rt}
                            <span class="rounded-md bg-indigo-50 border border-indigo-100 px-2 py-1 text-xs text-indigo-700 font-medium">
                                {rt.frequency ? `${rt.frequency} ` : ''}{rt.weekday} {rt.start_time}–{rt.end_time}
                            </span>
                        {/each}
                    </div>
                </div>
            {/if}
            {#if selectedDetail.events?.length > 0}
                <div class="mt-3">
                    <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Einzeltermine</p>
                    <div class="flex flex-wrap gap-2">
                        {#each selectedDetail.events.slice(0, 8) as ev}
                            <span class="rounded-md bg-white border border-slate-200 px-2 py-1 text-xs text-slate-700">
                                {ev.date} · {ev.start_time}–{ev.end_time} · {ev.room}
                            </span>
                        {/each}
                        {#if selectedDetail.events.length > 8}
                            <span class="text-xs text-slate-400">+{selectedDetail.events.length - 8} weitere</span>
                        {/if}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>
