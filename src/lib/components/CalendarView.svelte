<script lang="ts">
    import { selectedLectures } from '$lib/stores/selectedLectures.svelte';
    import type { DetailEvent } from '$lib/types/lecture';

    const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
    const DAY_SHORT: Record<string, number> = {
        'Mo': 0, 'Di': 1, 'Mi': 2, 'Do': 3, 'Fr': 4,
        'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4,
        'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4
    };

    const START_HOUR = 8;
    const END_HOUR = 18;
    const TOTAL_HOURS = END_HOUR - START_HOUR;
    const SLOT_HEIGHT = 60; // px per hour

    interface CalEvent {
        title: string;
        startMin: number; // minutes from START_HOUR
        endMin: number;
        day: number;
        credits: number | null;
        color: string;
    }

    const COLORS = [
        'bg-indigo-200 border-indigo-400 text-indigo-900',
        'bg-emerald-200 border-emerald-400 text-emerald-900',
        'bg-violet-200 border-violet-400 text-violet-900',
        'bg-amber-200 border-amber-400 text-amber-900',
        'bg-sky-200 border-sky-400 text-sky-900',
        'bg-rose-200 border-rose-400 text-rose-900',
        'bg-teal-200 border-teal-400 text-teal-900',
        'bg-orange-200 border-orange-400 text-orange-900',
    ];

    function parseTime(t: string): number {
        // Returns minutes since midnight
        const parts = t.trim().split(':');
        if (parts.length >= 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
        return 0;
    }

    function guessDayFromDate(dateStr: string): number | null {
        // Try parsing weekday from date string like "Mo 12.05.2025" or "2025-05-12"
        const firstWord = dateStr.trim().split(/[\s,]/)[0];
        if (DAY_SHORT[firstWord] !== undefined) return DAY_SHORT[firstWord];

        // Try parsing actual date
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            const dow = d.getDay(); // 0=Sun
            if (dow >= 1 && dow <= 5) return dow - 1;
        }
        return null;
    }

    // Build events from selected lectures
    const calEvents = $derived((): { day: number; events: CalEvent[] }[] => {
        const byDay: CalEvent[][] = [[], [], [], [], []];

        selectedLectures.forEach((sel, colorIdx) => {
            const color = COLORS[colorIdx % COLORS.length];
            const events = sel.detail?.events ?? [];

            // Deduplicate by weekday+time (show each slot once)
            const seen = new Set<string>();

            for (const ev of events) {
                const day = guessDayFromDate(ev.date);
                if (day === null) continue;

                const startMin = parseTime(ev.start_time) - START_HOUR * 60;
                const endMin = parseTime(ev.end_time) - START_HOUR * 60;

                const key = `${day}-${startMin}-${endMin}`;
                if (seen.has(key)) continue;
                seen.add(key);

                if (startMin < 0 || endMin > TOTAL_HOURS * 60) continue;

                byDay[day].push({
                    title: sel.catalog.title,
                    startMin,
                    endMin,
                    day,
                    credits: sel.catalog.credits,
                    color
                });
            }

            // If no events parsed, try lecture_times from catalog (not available here, skip)
        });

        return byDay.map((events, day) => ({ day, events }));
    });

    // Detect overlaps and assign columns
    function assignColumns(events: CalEvent[]) {
        // Sort by start
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

        // Assign width fraction
        return sorted.map(ev => {
            // How many columns overlap this event?
            const overlappingCols = columns.filter(col =>
                col.some(other => other.startMin < ev.endMin && other.endMin > ev.startMin)
            );
            const colIndex = overlappingCols.findIndex(col => col.includes(ev));
            return {
                ev,
                totalCols: overlappingCols.length,
                colIndex
            };
        });
    }
</script>

<div class="flex h-full flex-col overflow-hidden">
    {#if selectedLectures.length === 0}
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
            <span class="text-4xl">📅</span>
            <p class="text-sm">Keine Vorlesungen ausgewählt. Wähle zuerst Vorlesungen in der Kursauswahl.</p>
        </div>
    {:else}
        <div class="flex-1 overflow-auto">
            <div class="min-w-[700px]">
                <!-- Header row -->
                <div class="flex border-b border-slate-200 bg-white sticky top-0 z-10">
                    <div class="w-14 shrink-0"></div>
                    {#each DAYS as day}
                        <div class="flex-1 border-l border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide">
                            {day}
                        </div>
                    {/each}
                </div>

                <!-- Grid -->
                <div class="flex">
                    <!-- Time labels -->
                    <div class="w-14 shrink-0">
                        {#each Array(TOTAL_HOURS) as _, i}
                            <div class="flex items-start justify-end pr-2 text-xs text-slate-400" style="height: {SLOT_HEIGHT}px; padding-top: 4px;">
                                {START_HOUR + i}:00
                            </div>
                        {/each}
                    </div>

                    <!-- Day columns -->
                    {#each calEvents() as { day, events }}
                        <div class="relative flex-1 border-l border-slate-200" style="height: {TOTAL_HOURS * SLOT_HEIGHT}px;">
                            <!-- Hour grid lines -->
                            {#each Array(TOTAL_HOURS) as _, i}
                                <div class="absolute w-full border-t border-slate-100" style="top: {i * SLOT_HEIGHT}px;"></div>
                            {/each}
                            <!-- Half-hour lines -->
                            {#each Array(TOTAL_HOURS) as _, i}
                                <div class="absolute w-full border-t border-slate-50" style="top: {i * SLOT_HEIGHT + SLOT_HEIGHT / 2}px;"></div>
                            {/each}

                            <!-- Events -->
                            {#each assignColumns(events) as { ev, totalCols, colIndex }}
                                {@const topPx = (ev.startMin / 60) * SLOT_HEIGHT}
                                {@const heightPx = Math.max(((ev.endMin - ev.startMin) / 60) * SLOT_HEIGHT - 2, 20)}
                                {@const widthPct = 100 / totalCols}
                                {@const leftPct = colIndex * widthPct}
                                <div
                                    class="absolute rounded border-l-2 px-1.5 py-1 text-xs overflow-hidden shadow-sm {ev.color}"
                                    style="
                                        top: {topPx + 1}px;
                                        height: {heightPx}px;
                                        left: calc({leftPct}% + 2px);
                                        width: calc({widthPct}% - 4px);
                                    "
                                    title="{ev.title}"
                                >
                                    <p class="font-semibold leading-tight truncate">{ev.title}</p>
                                    {#if heightPx > 30}
                                        <p class="opacity-70 text-[10px]">{Math.floor((START_HOUR * 60 + ev.startMin) / 60)}:{String((ev.startMin % 60)).padStart(2,'0')}–{Math.floor((START_HOUR * 60 + ev.endMin) / 60)}:{String((ev.endMin % 60)).padStart(2,'0')}</p>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        </div>

        <!-- Legend -->
        <div class="border-t border-slate-200 px-4 py-2 bg-white flex flex-wrap gap-3">
            {#each selectedLectures as sel, i}
                <div class="flex items-center gap-1.5 text-xs text-slate-700">
                    <span class="h-3 w-3 rounded-sm {COLORS[i % COLORS.length].split(' ')[0]}"></span>
                    {sel.catalog.title}
                </div>
            {/each}
        </div>
    {/if}
</div>
