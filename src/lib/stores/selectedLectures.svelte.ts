import type { CatalogEntry, LectureDetail, SelectedLecture } from '$lib/types/lecture';

// Selections are scoped per semester (periodeId). unibas_id is stable across
// languages within one semester, so switching DE<->EN keeps the same
// selection — only the display language of catalog/detail data changes.
// Persisted to localStorage so selections survive page reloads/closing.

export const selectedLectures = $state<SelectedLecture[]>([]);

let currentPeriodeId: string | null = null;
let loadToken = 0; // guards against race conditions from rapid semester switches

interface StoredEntry {
    unibasId: number;
    active: boolean;
    calendarHidden: boolean;
}

function storageKey(periodeId: string): string {
    return `vorlesungsplaner:selections:${periodeId}`;
}

function readStoredEntries(periodeId: string): StoredEntry[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(storageKey(periodeId));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        // Backward compat: older versions stored a plain number[] of unibas_ids.
        if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'number')) {
            return (parsed as number[]).map(unibasId => ({ unibasId, active: true, calendarHidden: false }));
        }
        return (parsed as any[]).map(e => ({ unibasId: e.unibasId, active: e.active, calendarHidden: e.calendarHidden ?? false }));
    } catch {
        return [];
    }
}

function writeStoredEntries(periodeId: string, entries: StoredEntry[]) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(storageKey(periodeId), JSON.stringify(entries));
    } catch {
        // storage full or unavailable — ignore, selections just won't persist
    }
}

function persistCurrent() {
    if (!currentPeriodeId) return;
    const entries = selectedLectures
        .filter(l => l.catalog.unibas_id !== null)
        .map(l => ({ unibasId: l.catalog.unibas_id as number, active: l.active, calendarHidden: l.calendarHidden }));
    writeStoredEntries(currentPeriodeId, entries);
}

/**
 * Load the selection list for a given semester+language. Re-fetches catalog
 * entry + detail for every stored unibas_id in the requested language, so
 * switching DE<->EN re-renders the same lectures with localized text.
 */
export async function loadSelectionsForSemester(periodeId: string, lang: string) {
    currentPeriodeId = periodeId;
    const myToken = ++loadToken;

    const entries = readStoredEntries(periodeId);
    if (entries.length === 0) {
        if (myToken === loadToken) selectedLectures.splice(0, selectedLectures.length);
        return;
    }

    const loaded: SelectedLecture[] = [];
    for (const entry of entries) {
        try {
            const catRes = await fetch(`/api/lectures/catalog-entry/${entry.unibasId}?periodeId=${periodeId}&lang=${lang}`);
            if (!catRes.ok) continue;
            const catalog: CatalogEntry = await catRes.json();

            let detail: LectureDetail | null = null;
            try {
                const detRes = await fetch(`/api/lectures/${entry.unibasId}?periodeId=${periodeId}&lang=${lang}`);
                if (detRes.ok) detail = await detRes.json();
            } catch {
                // detail fetch failing shouldn't block showing the selection
            }

            loaded.push({ catalog, detail, selectedModuleIndex: 0, included: true, active: entry.active, calendarHidden: entry.calendarHidden });
        } catch {
            // skip lectures that can't be resolved (e.g. removed from catalog)
        }
    }

    // Only apply if no newer load has started in the meantime
    if (myToken === loadToken) {
        selectedLectures.splice(0, selectedLectures.length, ...loaded);
    }
}

export function addLecture(catalog: CatalogEntry, detail: LectureDetail | null) {
    if (catalog.unibas_id === null) return;
    const exists = selectedLectures.some(l => l.catalog.unibas_id === catalog.unibas_id);
    if (!exists) {
        selectedLectures.push({ catalog, detail, selectedModuleIndex: 0, included: true, active: true, calendarHidden: false });
        persistCurrent();
    }
}

export function removeLecture(unibasId: number | null) {
    if (unibasId === null) return;
    const idx = selectedLectures.findIndex(l => l.catalog.unibas_id === unibasId);
    if (idx !== -1) {
        selectedLectures.splice(idx, 1);
        persistCurrent();
    }
}

export function isSelected(unibasId: number | null): boolean {
    if (unibasId === null) return false;
    return selectedLectures.some(l => l.catalog.unibas_id === unibasId);
}

/**
 * Master visibility toggle for a selected lecture — when off, it's hidden
 * from the Kalender view and doesn't appear at all in Module & KP (distinct
 * from ModuleView's own per-row "count toward calculation" checkbox, which
 * only matters for lectures that ARE active/visible).
 */
export function toggleActive(unibasId: number | null) {
    if (unibasId === null) return;
    const sel = selectedLectures.find(l => l.catalog.unibas_id === unibasId);
    if (sel) {
        sel.active = !sel.active;
        persistCurrent();
    }
}

/**
 * Reorders the selection list by moving the lecture identified by
 * `draggedUnibasId` to sit directly before `targetUnibasId` (used for
 * drag-and-drop reordering in the panel). Pass `targetUnibasId = null` to
 * move the lecture to the end of the list. Order is persisted like any
 * other change to the selection.
 */
export function reorderLectures(draggedUnibasId: number | null, targetUnibasId: number | null) {
    if (draggedUnibasId === null || draggedUnibasId === targetUnibasId) return;
    const fromIdx = selectedLectures.findIndex(l => l.catalog.unibas_id === draggedUnibasId);
    if (fromIdx === -1) return;
    const [moved] = selectedLectures.splice(fromIdx, 1);
    if (targetUnibasId === null) {
        selectedLectures.push(moved);
    } else {
        const toIdx = selectedLectures.findIndex(l => l.catalog.unibas_id === targetUnibasId);
        if (toIdx === -1) {
            selectedLectures.push(moved);
        } else {
            selectedLectures.splice(toIdx, 0, moved);
        }
    }
    persistCurrent();
}

/**
 * Legend-only visibility toggle — hides the lecture from the Kalender grid
 * without touching `active`, so it stays checked/visible in "Meine Auswahl"
 * and in Module & KP, and remains listed (just dimmed) in the legend so it
 * can be shown again from there.
 */
export function toggleCalendarHidden(unibasId: number | null) {
    if (unibasId === null) return;
    const sel = selectedLectures.find(l => l.catalog.unibas_id === unibasId);
    if (sel) {
        sel.calendarHidden = !sel.calendarHidden;
        persistCurrent();
    }
}
