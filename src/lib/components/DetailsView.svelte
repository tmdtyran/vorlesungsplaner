<script lang="ts">
    import { activeSemester } from '$lib/stores/semester.svelte';
    import { nav } from '$lib/stores/navigation.svelte';
    import { addLecture, isSelected } from '$lib/stores/selectedLectures.svelte';
    import SelectedLecturesPanel from './SelectedLecturesPanel.svelte';
    import type { CatalogEntry, FullLectureDetails, LectureDetail } from '$lib/types/lecture';

    type SubTab = 'description' | 'admission' | 'dates' | 'modules' | 'assessment';

    let courseNumberInput = $state('');
    let loading = $state(false);
    let errorMsg = $state<string | null>(null);
    let full = $state<FullLectureDetails | null>(null);
    let catalogEntry = $state<CatalogEntry | null>(null);
    let lightDetail = $state<LectureDetail | null>(null);
    let activeSubTab = $state<SubTab>('description');

    const subTabs: { id: SubTab; label: string; icon: string }[] = [
        { id: 'description', label: 'Beschreibung', icon: 'ℹ️' },
        { id: 'admission', label: 'Teilnahmevoraussetzungen', icon: '👤' },
        { id: 'dates', label: 'Termine und Räume', icon: '📅' },
        { id: 'modules', label: 'Module', icon: '🎓' },
        { id: 'assessment', label: 'Leistungsüberprüfung', icon: '📝' },
    ];

    const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    // "2026-09-15" -> "Dienstag 15-09-2026"
    function formatDate(iso: string): string {
        const d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        const wd = WEEKDAYS_DE[d.getDay()];
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${wd} ${dd}-${mm}-${d.getFullYear()}`;
    }

    function weekdayOf(iso: string): string {
        const d = new Date(iso + 'T00:00:00');
        return isNaN(d.getTime()) ? '' : WEEKDAYS_DE[d.getDay()];
    }

    // Some individual session rows have no per-row time override (shown as
    // "–" on the source page) since they simply follow the recurring weekly
    // slot — fall back to that pattern's time for the matching weekday.
    function sessionTime(session: { date: string; startTime: string; endTime: string }): string {
        if (session.startTime && session.endTime) {
            return `${session.startTime}–${session.endTime}`;
        }
        const wd = weekdayOf(session.date).toLowerCase();
        const match = full?.datesAndRooms.pattern.find(p => p.weekday.toLowerCase() === wd);
        return match ? match.time : '–';
    }

    // Fetches the catalog entry + lightweight detail needed to add this
    // lecture to "Meine Auswahl" — done alongside the full-details load so
    // the "+" button works instantly without an extra round trip on click.
    async function loadSupportingData(unibasId: number) {
        try {
            const [catRes, detRes] = await Promise.all([
                fetch(`/api/lectures/catalog-entry/${unibasId}?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`),
                fetch(`/api/lectures/${unibasId}?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`)
            ]);
            catalogEntry = catRes.ok ? await catRes.json() : null;
            lightDetail = detRes.ok ? await detRes.json() : null;
        } catch {
            catalogEntry = null;
            lightDetail = null;
        }
    }

    function handleAddToSelection() {
        if (catalogEntry) addLecture(catalogEntry, lightDetail);
    }

    async function loadByUnibasId(unibasId: number) {
        loading = true;
        errorMsg = null;
        full = null;
        catalogEntry = null;
        lightDetail = null;
        try {
            const res = await fetch(`/api/lectures/${unibasId}/full?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                errorMsg = err.error ?? `Vorlesung ${unibasId} nicht gefunden.`;
                loading = false;
                return;
            }
            full = await res.json();
            courseNumberInput = full?.courseNumber ?? courseNumberInput;
            activeSubTab = 'description';
            await loadSupportingData(unibasId);
        } catch (err: any) {
            errorMsg = err?.message ?? String(err);
        }
        loading = false;
    }

    async function loadByCourseNumber(courseNumber: string) {
        loading = true;
        errorMsg = null;
        full = null;
        catalogEntry = null;
        lightDetail = null;
        try {
            const res = await fetch(`/api/lectures/by-course-number/${encodeURIComponent(courseNumber)}/full?periodeId=${activeSemester.periodeId}&lang=${activeSemester.lang}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                errorMsg = err.error ?? `Keine Vorlesung mit Kursnummer "${courseNumber}" gefunden.`;
                loading = false;
                return;
            }
            full = await res.json();
            activeSubTab = 'description';
            if (full?.unibasId) await loadSupportingData(full.unibasId);
        } catch (err: any) {
            errorMsg = err?.message ?? String(err);
        }
        loading = false;
    }

    function handleSubmit() {
        const cn = courseNumberInput.trim();
        if (!cn) {
            errorMsg = 'Bitte eine Kursnummer eingeben (z.B. 65935-01).';
            return;
        }
        loadByCourseNumber(cn);
    }

    // Selecting a lecture from "Meine Auswahl" fills the search field and
    // loads its full details, same as typing the course number manually.
    function handleSelectFromPanel(catalog: CatalogEntry) {
        if (catalog.course_number) {
            courseNumberInput = catalog.course_number;
            loadByCourseNumber(catalog.course_number);
        }
    }

    // Arriving via the "Weiteres" button from Kursauswahl — that flow knows
    // the internal unibas_id already, so it loads directly by ID and then
    // syncs the visible field to the matching course number.
    $effect(() => {
        if (nav.detailsUnibasId !== null) {
            loadByUnibasId(nav.detailsUnibasId);
        }
    });
</script>

<div class="flex h-full">
<div class="flex-1 flex flex-col min-w-0">
    <!-- Course number input -->
    <div class="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
        <label class="text-xs font-medium text-slate-500 uppercase tracking-wide shrink-0">Kursnummer</label>
        <input
            bind:value={courseNumberInput}
            onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="z.B. 65935-01"
            class="w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
        />
        <button
            onclick={handleSubmit}
            disabled={loading}
            class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
            {#if loading}
                <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
            {/if}
            Laden
        </button>
        {#if full}
            <span class="ml-2 flex items-center gap-2 text-sm text-slate-500 truncate min-w-0">
                {full.courseNumber ?? ''}
                {#if full.typeLabel}
                    <span class="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
                        {full.typeLabel}
                    </span>
                {/if}
                <span class="font-medium text-slate-700 truncate">{full.title}</span>
                {#if full.credits}
                    <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {full.credits} KP
                    </span>
                {/if}
            </span>
            <button
                onclick={handleAddToSelection}
                disabled={!catalogEntry || isSelected(full.unibasId)}
                class="ml-auto shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-colors
                    {isSelected(full.unibasId)
                        ? 'bg-emerald-100 text-emerald-600 cursor-default'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed'}"
                title={isSelected(full.unibasId) ? 'Bereits in Meine Auswahl' : 'Zu Meine Auswahl hinzufügen'}
            >
                {isSelected(full.unibasId) ? '✓' : '+'}
            </button>
        {/if}
    </div>

    {#if loading}
        <div class="flex flex-1 items-center justify-center text-slate-400 text-sm">Lädt…</div>
    {:else if errorMsg}
        <div class="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <span class="text-3xl">🔍</span>
            <p class="text-sm">{errorMsg}</p>
        </div>
    {:else if !full}
        <div class="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <span class="text-3xl">📋</span>
            <p class="text-sm">Gib eine Kursnummer ein, um alle Details zu sehen.</p>
        </div>
    {:else}
        <!-- Sub-tab bar -->
        <div class="flex items-center gap-1 border-b border-slate-200 px-4 overflow-x-auto">
            {#each subTabs as st}
                <button
                    onclick={() => activeSubTab = st.id}
                    class="relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors
                        {activeSubTab === st.id
                            ? 'text-indigo-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-600'
                            : 'text-slate-500 hover:text-slate-800'}"
                >
                    <span>{st.icon}</span>
                    {st.label}
                </button>
            {/each}
        </div>

        <!-- Sub-tab content -->
        <div class="flex-1 overflow-y-auto p-6">
            {#if activeSubTab === 'description'}
                <div class="max-w-3xl space-y-4">
                    {#if full.description.semester}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Semester</span><p class="text-sm text-slate-600">{full.description.semester}</p></div>
                    {/if}
                    {#if full.description.pattern}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Angebotsmuster</span><p class="text-sm text-slate-600">{full.description.pattern}</p></div>
                    {/if}
                    {#if full.description.lecturers}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Dozierende</span><p class="text-sm text-slate-600">{full.description.lecturers}</p></div>
                    {/if}
                    {#if full.description.content}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Inhalt</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.description.content}</p></div>
                    {/if}
                    {#if full.description.learningObjectives}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Lernziele</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.description.learningObjectives}</p></div>
                    {/if}
                    {#if full.description.remarks}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Bemerkungen</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.description.remarks}</p></div>
                    {/if}
                    {#if !full.description.content && !full.description.learningObjectives && !full.description.remarks}
                        <p class="text-sm text-slate-400">Keine Beschreibung vorhanden.</p>
                    {/if}
                    {#if full.debugRawHtmlSnippet}
                        <details class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <summary class="text-xs font-semibold text-amber-700 uppercase tracking-wide cursor-pointer">
                                ⚠ Debug: Rohes HTML (keine Felder erkannt)
                            </summary>
                            <p class="text-xs text-amber-700 mt-2 mb-2">
                                Es konnten keine Label/Wert-Paare auf dieser Seite erkannt werden. Kopiere den Ausschnitt unten und teile ihn, damit der Parser angepasst werden kann.
                            </p>
                            <pre class="text-[10px] text-slate-600 bg-white border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{full.debugRawHtmlSnippet}</pre>
                        </details>
                    {/if}
                </div>
            {:else if activeSubTab === 'admission'}
                <div class="max-w-3xl space-y-4">
                    {#if full.admissionRequirements.requirements}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Teilnahmevoraussetzungen</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.admissionRequirements.requirements}</p></div>
                    {/if}
                    {#if full.admissionRequirements.registration}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Anmeldung zur Lehrveranstaltung</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.admissionRequirements.registration}</p></div>
                    {/if}
                    {#if full.admissionRequirements.language}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Unterrichtssprache</span><p class="text-sm text-slate-600">{full.admissionRequirements.language}</p></div>
                    {/if}
                    {#if full.admissionRequirements.digitalMedia}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Einsatz digitaler Medien</span><p class="text-sm text-slate-600">{full.admissionRequirements.digitalMedia}</p></div>
                    {/if}
                    {#if !full.admissionRequirements.requirements && !full.admissionRequirements.registration}
                        <p class="text-sm text-slate-400">Keine Angaben vorhanden.</p>
                    {/if}
                </div>
            {:else if activeSubTab === 'dates'}
                <div class="max-w-3xl space-y-6">
                    {#if full.datesAndRooms.pattern.length > 0}
                        <div>
                            <span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-2">Regelmässigkeit</span>
                            <div class="flex flex-wrap gap-2">
                                {#each full.datesAndRooms.pattern as p}
                                    <span class="rounded-md bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 text-xs text-indigo-700 font-medium">
                                        {p.frequency} {p.weekday} {p.time}{p.room ? ` · ${p.room}` : ''}
                                    </span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                    {#if full.datesAndRooms.sessions.length > 0}
                        <div>
                            <span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-2">Einzeltermine ({full.datesAndRooms.sessions.length})</span>
                            <div class="rounded-lg border border-slate-200 overflow-hidden">
                                <table class="w-full text-sm">
                                    <thead class="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th class="px-3 py-2 text-left text-xs font-medium text-slate-500">Datum</th>
                                            <th class="px-3 py-2 text-left text-xs font-medium text-slate-500">Zeit</th>
                                            <th class="px-3 py-2 text-left text-xs font-medium text-slate-500">Raum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each full.datesAndRooms.sessions as s}
                                            <tr class="border-b border-slate-100 last:border-0">
                                                <td class="px-3 py-2 text-slate-700">{formatDate(s.date)}</td>
                                                <td class="px-3 py-2 text-slate-700">{sessionTime(s)}</td>
                                                <td class="px-3 py-2 text-slate-700">{s.room}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    {/if}
                    {#if full.datesAndRooms.pattern.length === 0 && full.datesAndRooms.sessions.length === 0}
                        <p class="text-sm text-slate-400">Keine Termine vorhanden.</p>
                    {/if}
                </div>
            {:else if activeSubTab === 'modules'}
                <div class="max-w-3xl">
                    {#if full.modules.length > 0}
                        <div class="flex flex-col gap-2">
                            {#each full.modules as m}
                                <div class="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-sm text-emerald-700 font-medium">{m}</div>
                            {/each}
                        </div>
                    {:else}
                        <p class="text-sm text-slate-400">Keinem Modul zugeordnet.</p>
                    {/if}
                </div>
            {:else if activeSubTab === 'assessment'}
                <div class="max-w-3xl space-y-4">
                    {#if full.assessment.format}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Prüfung</span><p class="text-sm text-slate-600">{full.assessment.format}</p></div>
                    {/if}
                    {#if full.assessment.details}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Hinweise zur Prüfung</span><p class="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{full.assessment.details}</p></div>
                    {/if}
                    {#if full.assessment.registration}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">An-/Abmeldung zur Prüfung</span><p class="text-sm text-slate-600">{full.assessment.registration}</p></div>
                    {/if}
                    {#if full.assessment.retake}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Wiederholungsprüfung</span><p class="text-sm text-slate-600">{full.assessment.retake}</p></div>
                    {/if}
                    {#if full.assessment.scale}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Skala</span><p class="text-sm text-slate-600">{full.assessment.scale}</p></div>
                    {/if}
                    {#if full.assessment.retakeOnFail}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Belegen bei Nichtbestehen</span><p class="text-sm text-slate-600">{full.assessment.retakeOnFail}</p></div>
                    {/if}
                    {#if full.assessment.faculty}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Zuständige Fakultät</span><p class="text-sm text-slate-600">{full.assessment.faculty}</p></div>
                    {/if}
                    {#if full.assessment.offeredBy}
                        <div><span class="text-xs font-bold text-slate-800 uppercase tracking-wide block mb-1">Anbietende Organisationseinheit</span><p class="text-sm text-slate-600">{full.assessment.offeredBy}</p></div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>

<SelectedLecturesPanel onSelect={handleSelectFromPanel} />
</div>
