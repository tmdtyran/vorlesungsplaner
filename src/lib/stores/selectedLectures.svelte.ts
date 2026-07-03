import type { CatalogEntry, LectureDetail, SelectedLecture } from '$lib/types/lecture';

// Selections are scoped per semester (periodeId). unibas_id is stable across
// languages within one semester, so switching DE<->EN keeps the same
// selection — only the display language of catalog/detail data changes.
// Persisted to localStorage so selections survive page reloads/closing.

export const selectedLectures = $state<SelectedLecture[]>([]);

let currentPeriodeId: string | null = null;
let loadToken = 0; // guards against race conditions from rapid semester switches

function storageKey(periodeId: string): string {
    return `vorlesungsplaner:selections:${periodeId}`;
}

function readStoredIds(periodeId: string): number[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(storageKey(periodeId));
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function writeStoredIds(periodeId: string, ids: number[]) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(storageKey(periodeId), JSON.stringify(ids));
    } catch {
        // storage full or unavailable — ignore, selections just won't persist
    }
}

function persistCurrent() {
    if (!currentPeriodeId) return;
    const ids = selectedLectures
        .map(l => l.catalog.unibas_id)
        .filter((id): id is number => id !== null);
    writeStoredIds(currentPeriodeId, ids);
}

/**
 * Load the selection list for a given semester+language. Re-fetches catalog
 * entry + detail for every stored unibas_id in the requested language, so
 * switching DE<->EN re-renders the same lectures with localized text.
 */
export async function loadSelectionsForSemester(periodeId: string, lang: string) {
    currentPeriodeId = periodeId;
    const myToken = ++loadToken;

    const ids = readStoredIds(periodeId);
    if (ids.length === 0) {
        if (myToken === loadToken) selectedLectures.splice(0, selectedLectures.length);
        return;
    }

    const loaded: SelectedLecture[] = [];
    for (const unibasId of ids) {
        try {
            const catRes = await fetch(`/api/lectures/catalog-entry/${unibasId}?periodeId=${periodeId}&lang=${lang}`);
            if (!catRes.ok) continue;
            const catalog: CatalogEntry = await catRes.json();

            let detail: LectureDetail | null = null;
            try {
                const detRes = await fetch(`/api/lectures/${unibasId}?periodeId=${periodeId}&lang=${lang}`);
                if (detRes.ok) detail = await detRes.json();
            } catch {
                // detail fetch failing shouldn't block showing the selection
            }

            loaded.push({ catalog, detail, selectedModuleIndex: 0, included: true });
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
        selectedLectures.push({ catalog, detail, selectedModuleIndex: 0, included: true });
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
