<script lang="ts">
    import { selectedLectures } from '$lib/stores/selectedLectures.svelte';

    const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

    // All known weekday spellings → 0-based Mon=0
    const DAY_MAP: Record<string, number> = {
        'Mo': 0, 'Di': 1, 'Mi': 2, 'Do': 3, 'Fr': 4,
        'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4,
        'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4,
        'Montag': 0, 'Dienstag': 1, 'Mittwoch': 2, 'Donnerstag': 3, 'Freitag': 4,
    };

    const START_HOUR = 8;
    const END_HOUR = 18;
    const TOTAL_HOURS = END_HOUR - START_HOUR;
    const SLOT_HEIGHT = 64;

    interface CalEvent {
        title: string;
        startMin: number; // minutes offset from START_HOUR*60
        endMin: number;
        color: string;
        timeLabel: string;
    }

    const COLORS = [
        { bg: 'bg-indigo-100', border: 'border-indigo-500', text: 'text-indigo-900', dot: 'bg-indigo-400' },
        { bg: 'bg-emerald-100', border: 'border-emerald-500', text: 'text-emerald-900', dot: 'bg-emerald-400' },
        { bg: 'bg-violet-100', border: 'border-violet-500', text: 'text-violet-900', dot: 'bg-violet-400' },
        { bg: 'bg-amber-100', border: 'border-amber-500', text: 'text-amber-900', dot: 'bg-amber-400' },
        { bg: 'bg-sky-100', border: 'border-sky-500', text: 'text-sky-900', dot: 'bg-sky-400' },
        { bg: 'bg-rose-100', border: 'border-rose-500', text: 'text-rose-900', dot: 'bg-rose-400' },
        { bg: 'bg-teal-100', border: 'border-teal-500', text: 'text-teal-900', dot: 'bg-teal-400' },
        { bg: 'bg-orange-100', border: 'border-orange-500', text: 'text-orange-900', dot: 'bg-orange-400' },
    ];

    // lecture_times row shape
    interface TimeRow {
        lecture_catalog_id: number;
        weekday: string;
        start_time: string;
        end_time: string;
        frequency: string | null;
    }

    let timesCache = $state<Map<number, TimeRow[]>>(new Map());
    let loadedIds = $state<Set<number>>(new Set());

    // Parse "HH:MM" or "HH.MM" → minutes since midnight
    function parseTime(t: string): number {
        if (!t) return 0;
        const clean = t.trim().replace('.', ':');
        const parts = clean.split(':');
        return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0');
    }

    function dayFromString(s: string): number | null {
        if (!s) return null;
        // Try exact match first
        const trimmed = s.trim();
        if (DAY_MAP[trimmed] !== undefined) return DAY_MAP[trimmed];
        // Try first word (e.g. "Mo 10:15-12:00")
        const first = trimmed.split(/[\s,\-]/)[0];
        if (DAY_MAP[first] !== undefined) return DAY_MAP[first];
        // Try parsing as date
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
            const dow = d.getDay();
            if (dow >= 1 && dow <= 5) return dow - 1;
        }
        return null;
    }

    // Fetch lecture_times for any newly selected lectures
    $effect(() => {
        const ids = selectedLectures.map(s => s.catalog.id);
        const missing = ids.filter(id => !loadedIds.has(id));
        if (missing.length === 0) return;

        fetch(`/api/lectures/times?ids=${missing.join(',')}`)
            .then(r => r.json())
            .then((rows: TimeRow[]) => {
                for (const id of missing) loadedIds.add(id);
                for (const row of rows) {
                    const existing = timesCache.get(row.lecture_catalog_id) ?? [];
                    existing.push(row);
                    timesCache.set(row.lecture_catalog_id, existing);
                }
                // trigger reactivity
                timesCache = new Map(timesCache);
            });
    });

    // Build per-day event lists
    const byDay = $derived((): CalEvent[][] => {
        const days: CalEvent[][] = [[], [], [], [], []];

        selectedLectures.forEach((sel, colorIdx) => {
            const color = COLORS[colorIdx % COLORS.length];
            const catalogId = sel.catalog.id;
            const times = timesCache.get(catalogId) ?? [];

            if (times.length > 0) {
                // Use lecture_times (recurring weekday slots)
                for (const t of times) {
                    const day = dayFromString(t.weekday);
                    if (day === null) continue;

                    const startMin = parseTime(t.start_time) - START_HOUR * 60;
                    const endMin = parseTime(t.end_time) - START_HOUR * 60;
                    if (startMin < 0 || endMin <= startMin) continue;
                    if (endMin > TOTAL_HOURS * 60) continue;

                    const timeLabel = `${t.start_time}–${t.end_time}`;
                    days[day].push({ title: sel.catalog.title, startMin, endMin, color: colorIdx.toString(), timeLabel });
                }
            } else if (sel.detail?.events?.length) {
                // Fallback: derive weekday from lecture_detail_events dates
                const seen = new Set<string>();
                for (const ev of sel.detail.events) {
                    const day = dayFromString(ev.date);
                    if (day === null) continue;

                    const startMin = parseTime(ev.start_time) - START_HOUR * 60;
                    const endMin = parseTime(ev.end_time) - START_HOUR * 60;
                    if (startMin < 0 || endMin <= startMin) continue;
                    if (endMin > TOTAL_HOURS * 60) continue;

                    const key = `${day}-${startMin}-${endMin}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const timeLabel = `${ev.start_time}–${ev.end_time}`;
                    days[day].push({ title: sel.catalog.title, startMin, endMin, color: colorIdx.toString(), timeLabel });
                }
            }
        });

        return days;
    });

    function assignColumns(events: CalEvent[]) {
        const sorted = [...events].sort((a, b) => a.startMin - b.startMin);
        const columns: CalEvent[][] = [];

        for (const ev of sorted) {
            let placed = false;
            for (const col of columns) {
                const last = col[col.length - 1];
                if (last.endMin <= ev.startMin) {
                    col.push(ev);
                    placed = true;
                    break;
                }
            }
            if (!placed) columns.push([ev]);
        }

        return sorted.map(ev => {
            const overlapping = columns.filter(col =>
                col.some(o => o.startMin < ev.endMin && o.endMin > ev.startMin)
            );
            const colIndex = overlapping.findIndex(col => col.includes(ev));
            return { ev, totalCols: overlapping.length, colIndex };
        });
    }

    function fmtMin(min: number): string {
        const abs = START_HOUR * 60 + min;
        return `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
    }
</script>

<div class="flex h-full flex-col overflow-hidden bg-white">
    {#if selectedLectures.length === 0}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
            <span class="text-4xl">📅</span>
            <p class="text-sm">Keine Vorlesungen ausgewählt. Wähle zuerst Vorlesungen in der Kursauswahl.</p>
        </div>
    {:else}
        <div class="flex-1 overflow-auto">
            <div class="min-w-[640px]">
                <!-- Header -->
                <div class="flex border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
                    <div class="w-14 shrink-0 border-r border-slate-100"></div>
                    {#each DAYS as day}
                        <div class="flex-1 border-l border-slate-100 px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            {day}
                        </div>
                    {/each}
                </div>

                <!-- Time grid -->
                <div class="flex">
                    <!-- Hour labels -->
                    <div class="w-14 shrink-0 border-r border-slate-100">
                        {#each Array(TOTAL_HOURS) as _, i}
                            <div
                                class="flex items-start justify-end pr-2 text-[11px] text-slate-400 font-medium"
                                style="height: {SLOT_HEIGHT}px; padding-top: 4px;"
                            >
                                {START_HOUR + i}:00
                            </div>
                        {/each}
                    </div>

                    <!-- Day columns -->
                    {#each byDay() as dayEvents, dayIdx}
                        <div
                            class="relative flex-1 border-l border-slate-100"
                            style="height: {TOTAL_HOURS * SLOT_HEIGHT}px;"
                        >
                            <!-- Hour lines -->
                            {#each Array(TOTAL_HOURS) as _, i}
                                <div
                                    class="absolute w-full border-t border-slate-100"
                                    style="top: {i * SLOT_HEIGHT}px;"
                                ></div>
                                <div
                                    class="absolute w-full border-t border-slate-50"
                                    style="top: {i * SLOT_HEIGHT + SLOT_HEIGHT / 2}px;"
                                ></div>
                            {/each}

                            <!-- Events -->
                            {#each assignColumns(dayEvents) as { ev, totalCols, colIndex }}
                                {@const topPx = (ev.startMin / 60) * SLOT_HEIGHT}
                                {@const heightPx = Math.max(((ev.endMin - ev.startMin) / 60) * SLOT_HEIGHT - 3, 22)}
                                {@const widthPct = 100 / totalCols}
                                {@const leftPct = colIndex * widthPct}
                                {@const ci = parseInt(ev.color) % COLORS.length}
                                {@const c = COLORS[ci]}
                                <div
                                    class="absolute rounded-md border-l-[3px] overflow-hidden shadow-sm
                                        {c.bg} {c.border} {c.text}"
                                    style="
                                        top: {topPx + 2}px;
                                        height: {heightPx}px;
                                        left: calc({leftPct}% + 3px);
                                        width: calc({widthPct}% - 6px);
                                    "
                                    title="{ev.title} · {ev.timeLabel}"
                                >
                                    <div class="px-1.5 py-1 h-full flex flex-col justify-start">
                                        <p class="text-[11px] font-semibold leading-tight line-clamp-2">{ev.title}</p>
                                        {#if heightPx > 36}
                                            <p class="text-[10px] opacity-60 mt-0.5">{ev.timeLabel}</p>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        </div>

        <!-- Legend -->
        <div class="border-t border-slate-200 bg-slate-50 px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {#each selectedLectures as sel, i}
                {@const c = COLORS[i % COLORS.length]}
                <div class="flex items-center gap-1.5 text-xs text-slate-700">
                    <span class="h-2.5 w-2.5 rounded-sm {c.dot}"></span>
                    <span class="max-w-56 truncate">{sel.catalog.title}</span>
                </div>
            {/each}
        </div>
    {/if}
</div>
