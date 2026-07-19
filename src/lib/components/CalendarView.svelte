<script lang="ts">
    import { selectedLectures, toggleCalendarHidden } from '$lib/stores/selectedLectures.svelte';
    import { activeSemester } from '$lib/stores/semester.svelte';
    import SelectedLecturesPanel from './SelectedLecturesPanel.svelte';
    import LectureMiniDetail from './LectureMiniDetail.svelte';
    import type { CatalogEntry, LectureDetail } from '$lib/types/lecture';
    import { t } from '$lib/i18n/translations';

    let selectedDetail = $state<LectureDetail | null>(null);

    async function handleSelectFromPanel(catalog: CatalogEntry) {
        if (!catalog.unibas_id) return;
        try {
            const res = await fetch(`/api/lectures/${catalog.unibas_id}?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`);
            selectedDetail = res.ok ? await res.json() : null;
        } catch {
            selectedDetail = null;
        }
    }

    const DAYS_DE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
    const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const DAYS = $derived(activeSemester.lang === 'en' ? DAYS_EN : DAYS_DE);

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

    type ViewMode = 'typical' | 'specific';
    let viewMode = $state<ViewMode>('typical');

    interface CalEvent {
        title: string;
        typeLabel: string | null;
        startMin: number;
        endMin: number;
        color: string;
        timeLabel: string;
        dateLabel?: string;
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

    interface TimeRow {
        lecture_catalog_id: number;
        weekday: string;
        start_time: string;
        end_time: string;
        frequency: string | null;
    }

    let timesCache = $state<Map<number, TimeRow[]>>(new Map());
    let loadedIds = $state<Set<number>>(new Set());

    const visibleLectures = $derived(selectedLectures.filter(s => s.active && !s.calendarHidden));

    // Colors are tied to unibas_id (not list position), so removing or
    // deactivating one lecture never shifts the colors of the others.
    function colorIndexFor(unibasId: number | null): number {
        if (unibasId === null) return 0;
        return Math.abs(unibasId) % COLORS.length;
    }

    function parseTime(t: string): number {
        if (!t) return 0;
        const clean = t.trim().replace('.', ':');
        const parts = clean.split(':');
        return parseInt(parts[0] ?? '0') * 60 + parseInt(parts[1] ?? '0');
    }

    function dayFromString(s: string): number | null {
        if (!s) return null;
        const trimmed = s.trim();
        if (DAY_MAP[trimmed] !== undefined) return DAY_MAP[trimmed];
        const first = trimmed.split(/[\s,\-]/)[0];
        if (DAY_MAP[first] !== undefined) return DAY_MAP[first];
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
            const dow = d.getDay();
            if (dow >= 1 && dow <= 5) return dow - 1;
        }
        return null;
    }

    function getISOWeek(date: Date): { week: number; year: number } {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - dayNum + 3);
        const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
        return { week, year: d.getUTCFullYear() };
    }

    function getMondayOfISOWeek(week: number, year: number): Date {
        const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
        const dow = simple.getUTCDay();
        const diff = dow <= 4 ? dow - 1 : dow - 8;
        const monday = new Date(simple);
        monday.setUTCDate(simple.getUTCDate() - diff);
        return monday;
    }

    function formatDateShort(d: Date): string {
        return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
    }

    const today = new Date();
    const initialISOWeek = getISOWeek(today);
    let currentWeek = $state(initialISOWeek.week);
    let currentYear = $state(initialISOWeek.year);

    const weekMonday = $derived(getMondayOfISOWeek(currentWeek, currentYear));
    const weekDates = $derived(
        Array.from({ length: 5 }, (_, i) => {
            const d = new Date(weekMonday);
            d.setUTCDate(weekMonday.getUTCDate() + i);
            return d;
        })
    );
    const weekRangeLabel = $derived(
        `${t('KW')} ${currentWeek} — ${formatDateShort(weekDates[0])} ${t('bis')} ${formatDateShort(weekDates[4])}`
    );

    function goToPrevWeek() {
        const prevMonday = new Date(weekMonday);
        prevMonday.setUTCDate(weekMonday.getUTCDate() - 7);
        const iso = getISOWeek(prevMonday);
        currentWeek = iso.week;
        currentYear = iso.year;
    }
    function goToNextWeek() {
        const nextMonday = new Date(weekMonday);
        nextMonday.setUTCDate(weekMonday.getUTCDate() + 7);
        const iso = getISOWeek(nextMonday);
        currentWeek = iso.week;
        currentYear = iso.year;
    }
    function goToCurrentWeek() {
        const iso = getISOWeek(new Date());
        currentWeek = iso.week;
        currentYear = iso.year;
    }

    $effect(() => {
        const ids = selectedLectures.map(s => s.catalog.id);
        const missing = ids.filter(id => !loadedIds.has(id));
        if (missing.length === 0) return;

        fetch(`/api/lectures/times?ids=${missing.join(',')}&periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`)
            .then(r => r.json())
            .then((rows: TimeRow[]) => {
                for (const id of missing) loadedIds.add(id);
                for (const row of rows) {
                    const existing = timesCache.get(row.lecture_catalog_id) ?? [];
                    existing.push(row);
                    timesCache.set(row.lecture_catalog_id, existing);
                }
                timesCache = new Map(timesCache);
            });
    });

    const byDayTypical = $derived((): CalEvent[][] => {
        const days: CalEvent[][] = [[], [], [], [], []];

        visibleLectures.forEach((sel) => {
            const catalogId = sel.catalog.id;
            const times = timesCache.get(catalogId) ?? [];

            if (times.length > 0) {
                const seen = new Set<string>();
                for (const t of times) {
                    const day = dayFromString(t.weekday);
                    if (day === null) continue;

                    const startMin = parseTime(t.start_time) - START_HOUR * 60;
                    const endMin = parseTime(t.end_time) - START_HOUR * 60;
                    if (startMin < 0 || endMin <= startMin) continue;
                    if (endMin > TOTAL_HOURS * 60) continue;

                    const key = `${day}-${startMin}-${endMin}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const timeLabel = `${t.start_time}–${t.end_time}`;
                    days[day].push({ title: `${sel.catalog.title}${sel.catalog.course_number ? ` (${sel.catalog.course_number})` : ""}`, typeLabel: sel.catalog.type_label, startMin, endMin, color: colorIndexFor(sel.catalog.unibas_id).toString(), timeLabel });
                }
            } else if (sel.detail?.events?.length) {
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
                    days[day].push({ title: `${sel.catalog.title}${sel.catalog.course_number ? ` (${sel.catalog.course_number})` : ""}`, typeLabel: sel.catalog.type_label, startMin, endMin, color: colorIndexFor(sel.catalog.unibas_id).toString(), timeLabel });
                }
            }
        });

        return days;
    });

    const byDaySpecific = $derived((): CalEvent[][] => {
        const days: CalEvent[][] = [[], [], [], [], []];

        const weekDateStrs = weekDates.map(d =>
            `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        );

        visibleLectures.forEach((sel) => {
            const events = sel.detail?.events ?? [];
            for (const ev of events) {
                const dayIdx = weekDateStrs.indexOf(ev.date);
                if (dayIdx === -1) continue;
                if (!ev.start_time || !ev.end_time) continue;

                const startMin = parseTime(ev.start_time) - START_HOUR * 60;
                const endMin = parseTime(ev.end_time) - START_HOUR * 60;
                if (startMin < 0 || endMin <= startMin) continue;
                if (endMin > TOTAL_HOURS * 60) continue;

                const timeLabel = `${ev.start_time}–${ev.end_time}`;
                days[dayIdx].push({
                    title: `${sel.catalog.title}${sel.catalog.course_number ? ` (${sel.catalog.course_number})` : ""}`,
                    typeLabel: sel.catalog.type_label,
                    startMin, endMin,
                    color: colorIndexFor(sel.catalog.unibas_id).toString(),
                    timeLabel,
                    dateLabel: ev.date
                });
            }
        });

        return days;
    });

    const byDay = $derived(viewMode === 'typical' ? byDayTypical() : byDaySpecific());

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

    // ==========================================================================
    // ICS export
    // ==========================================================================

    const WEEKDAY_TO_JS: Record<string, number> = {
        sonntag: 0, sunday: 0,
        montag: 1, monday: 1,
        dienstag: 2, tuesday: 2,
        mittwoch: 3, wednesday: 3,
        donnerstag: 4, thursday: 4,
        freitag: 5, friday: 5,
        samstag: 6, saturday: 6,
    };

    function lastSundayOfMonth(year: number, monthIndex: number): number {
        const d = new Date(Date.UTC(year, monthIndex + 1, 0));
        return d.getUTCDate() - d.getUTCDay();
    }
    function isDST(date: Date): boolean {
        const year = date.getUTCFullYear();
        const dstStart = new Date(Date.UTC(year, 2, lastSundayOfMonth(year, 2), 1, 0, 0));
        const dstEnd = new Date(Date.UTC(year, 9, lastSundayOfMonth(year, 9), 1, 0, 0));
        return date >= dstStart && date < dstEnd;
    }
    function zurichToUTC(dateStr: string, timeStr: string): Date {
        const [y, m, d] = dateStr.split('-').map(Number);
        const [hh, mm] = timeStr.split(':').map(Number);
        const naiveUTC = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
        const offset = isDST(naiveUTC) ? 2 : 1;
        return new Date(naiveUTC.getTime() - offset * 3600 * 1000);
    }
    function toICSDateTimeUTC(date: Date): string {
        const p = (n: number) => String(n).padStart(2, '0');
        return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
    }
    function escapeICS(text: string): string {
        return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    }
    function lectureUrl(unibasId: number): string {
        const path = activeSemester.lang === 'de' ? 'de/vorlesungsverzeichnis' : 'en/course-directory';
        return `https://vorlesungsverzeichnis.unibas.ch/${path}?id=${unibasId}`;
    }

    function buildLectureEvents(sel: (typeof selectedLectures)[0]): string[] {
        const events = sel.detail?.events ?? [];
        const pattern = timesCache.get(sel.catalog.id) ?? [];
        const uid_base = `${sel.catalog.unibas_id}@vorlesungsplaner`;
        const summary = `${sel.catalog.type_label ? sel.catalog.type_label + ' ' : ''}${sel.catalog.title}`;
        const description = sel.catalog.unibas_id ? lectureUrl(sel.catalog.unibas_id) : '';
        const blocks: string[] = [];

        if (pattern.length === 0 || events.length === 0) {
            events.forEach((ev, i) => {
                if (!ev.start_time || !ev.end_time) return;
                const start = zurichToUTC(ev.date, ev.start_time);
                const end = zurichToUTC(ev.date, ev.end_time);
                blocks.push([
                    'BEGIN:VEVENT',
                    `UID:${uid_base}-${i}`,
                    `DTSTAMP:${toICSDateTimeUTC(new Date())}`,
                    `DTSTART:${toICSDateTimeUTC(start)}`,
                    `DTEND:${toICSDateTimeUTC(end)}`,
                    `SUMMARY:${escapeICS(summary)}`,
                    `DESCRIPTION:${escapeICS(description)}`,
                    `LOCATION:${escapeICS(ev.room ?? '')}`,
                    'END:VEVENT'
                ].join('\r\n'));
            });
            return blocks;
        }

        const usedDates = new Set<string>();

        pattern.forEach((p, pIdx) => {
            const jsWeekday = WEEKDAY_TO_JS[p.weekday.trim().toLowerCase()];
            if (jsWeekday === undefined) return;

            const matching = events.filter(ev => {
                const d = new Date(ev.date + 'T00:00:00Z');
                return d.getUTCDay() === jsWeekday && ev.start_time === p.start_time && ev.end_time === p.end_time;
            });
            if (matching.length === 0) return;

            const dates = matching.map(ev => ev.date).sort();
            const dtstartDate = dates[0];
            const untilDate = dates[dates.length - 1];

            const expected: string[] = [];
            let cur = new Date(dtstartDate + 'T00:00:00Z');
            const until = new Date(untilDate + 'T00:00:00Z');
            while (cur <= until) {
                expected.push(cur.toISOString().slice(0, 10));
                cur.setUTCDate(cur.getUTCDate() + 7);
            }
            const actualSet = new Set(dates);
            const exceptions = expected.filter(d => !actualSet.has(d));

            dates.forEach(d => usedDates.add(d));

            const dtstart = zurichToUTC(dtstartDate, p.start_time);
            const dtend = zurichToUTC(dtstartDate, p.end_time);
            const untilUTC = zurichToUTC(untilDate, p.start_time);

            const lines = [
                'BEGIN:VEVENT',
                `UID:${uid_base}-rec-${pIdx}`,
                `DTSTAMP:${toICSDateTimeUTC(new Date())}`,
                `DTSTART:${toICSDateTimeUTC(dtstart)}`,
                `DTEND:${toICSDateTimeUTC(dtend)}`,
                `RRULE:FREQ=WEEKLY;UNTIL=${toICSDateTimeUTC(untilUTC)}`,
            ];
            for (const exDate of exceptions) {
                lines.push(`EXDATE:${toICSDateTimeUTC(zurichToUTC(exDate, p.start_time))}`);
            }
            lines.push(
                `SUMMARY:${escapeICS(summary)}`,
                `DESCRIPTION:${escapeICS(description)}`,
                `LOCATION:${escapeICS(matching[0].room ?? '')}`,
                'END:VEVENT'
            );
            blocks.push(lines.join('\r\n'));
        });

        events.forEach((ev, i) => {
            if (usedDates.has(ev.date) || !ev.start_time || !ev.end_time) return;
            const start = zurichToUTC(ev.date, ev.start_time);
            const end = zurichToUTC(ev.date, ev.end_time);
            blocks.push([
                'BEGIN:VEVENT',
                `UID:${uid_base}-extra-${i}`,
                `DTSTAMP:${toICSDateTimeUTC(new Date())}`,
                `DTSTART:${toICSDateTimeUTC(start)}`,
                `DTEND:${toICSDateTimeUTC(end)}`,
                `SUMMARY:${escapeICS(summary)}`,
                `DESCRIPTION:${escapeICS(description)}`,
                `LOCATION:${escapeICS(ev.room ?? '')}`,
                'END:VEVENT'
            ].join('\r\n'));
        });

        return blocks;
    }

    function exportICS() {
        const allBlocks: string[] = [];
        for (const sel of visibleLectures) {
            allBlocks.push(...buildLectureEvents(sel));
        }

        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Vorlesungsplaner//UniBasel//DE',
            'CALSCALE:GREGORIAN',
            ...allBlocks,
            'END:VCALENDAR'
        ].join('\r\n');

        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vorlesungsplaner-${activeSemester.periodeId}.ics`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
</script>

<div class="flex h-full flex-col overflow-hidden bg-white">
    <div class="flex items-center gap-3 border-b border-slate-200 px-4 py-2 flex-wrap min-h-15">
        <div class="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
            <button
                onclick={() => viewMode = 'typical'}
                class="px-3 py-1.5 text-xs font-medium transition-colors
                    {viewMode === 'typical' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
            >{t('Typische Woche')}</button>
            <button
                onclick={() => viewMode = 'specific'}
                class="px-3 py-1.5 text-xs font-medium transition-colors
                    {viewMode === 'specific' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}"
            >{t('Spezifische Woche')}</button>
        </div>

        {#if viewMode === 'specific'}
            <div class="flex items-center gap-2 shrink-0">
                <button onclick={goToPrevWeek} class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">‹</button>
                <span class="text-xs font-medium text-slate-700 whitespace-nowrap">{weekRangeLabel}</span>
                <button onclick={goToNextWeek} class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">›</button>
                <button onclick={goToCurrentWeek} class="text-xs text-indigo-600 hover:underline whitespace-nowrap">{t('Heute')}</button>
            </div>
        {/if}

        <button
            onclick={exportICS}
            disabled={visibleLectures.length === 0}
            class="ml-auto flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 shadow-sm transition-colors hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
            {t('📤 ICS exportieren')}
        </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

        {#if selectedLectures.length === 0}
            <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                <span class="text-4xl">📅</span>
                <p class="text-sm">{t('Keine Vorlesungen ausgewählt. Wähle zuerst Vorlesungen in der Kursauswahl.')}</p>
            </div>
        {:else}
            {#if visibleLectures.length === 0}
                <div class="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                    <span class="text-4xl">📅</span>
                    <p class="text-sm">{t('Keine Vorlesung im Kalender sichtbar — aktiviere eine in "Meine Auswahl" oder blende sie in der Legende unten wieder ein.')}</p>
                </div>
            {:else}
            <div class="flex-1 overflow-auto">
                <div class="min-w-[640px]">
                    <div class="flex border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
                        <div class="w-14 shrink-0 border-r border-slate-100"></div>
                        {#each DAYS as day, i}
                            <div class="flex-1 border-l border-slate-100 px-3 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                {day}
                                {#if viewMode === 'specific'}
                                    <span class="block text-[10px] font-normal normal-case text-slate-400 mt-0.5">{formatDateShort(weekDates[i])}</span>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <div class="flex">
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

                        {#each byDay as dayEvents, dayIdx}
                            <div
                                class="relative flex-1 border-l border-slate-100"
                                style="height: {TOTAL_HOURS * SLOT_HEIGHT}px;"
                            >
                                {#each Array(TOTAL_HOURS) as _, i}
                                    <div class="absolute w-full border-t border-slate-100" style="top: {i * SLOT_HEIGHT}px;"></div>
                                    <div class="absolute w-full border-t border-slate-50" style="top: {i * SLOT_HEIGHT + SLOT_HEIGHT / 2}px;"></div>
                                {/each}

                                {#if dayEvents.length === 0 && viewMode === 'specific'}
                                    <div class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-300">{t('frei')}</div>
                                {/if}

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
                                            {#if ev.typeLabel && heightPx > 36}
                                                <p class="text-[9px] font-bold uppercase tracking-wide opacity-70 leading-tight">{ev.typeLabel}</p>
                                            {/if}
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
            {/if}

            <div class="border-t border-slate-200 bg-slate-50 px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {#each selectedLectures.filter(s => s.active) as sel (sel.catalog.unibas_id)}
                    {@const c = COLORS[colorIndexFor(sel.catalog.unibas_id)]}
                    <button
                        onclick={() => toggleCalendarHidden(sel.catalog.unibas_id)}
                        class="flex items-center gap-1.5 text-xs transition-opacity {!sel.calendarHidden ? 'text-slate-700' : 'text-slate-400 opacity-50'}"
                        title={!sel.calendarHidden ? t('Im Kalender ausblenden') : t('Im Kalender anzeigen')}
                    >
                        <span class="h-3 w-3 rounded-sm border-2 flex items-center justify-center shrink-0
                            {!sel.calendarHidden ? c.dot + ' border-transparent' : 'border-slate-300 bg-white'}">
                            {#if !sel.calendarHidden}<span class="text-white text-[7px] leading-none">✓</span>{/if}
                        </span>
                        {#if sel.catalog.type_label}
                            <span class="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">{sel.catalog.type_label}</span>
                        {/if}
                        <span class="max-w-56 truncate">{sel.catalog.title}</span>
                    </button>
                {/each}
            </div>
        {/if}

        <LectureMiniDetail detail={selectedDetail} onClose={() => selectedDetail = null} />
    </div>

    <SelectedLecturesPanel onSelect={handleSelectFromPanel} />
    </div>
</div>
