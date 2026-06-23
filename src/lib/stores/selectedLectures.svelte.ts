import type { CatalogEntry, LectureDetail, SelectedLecture } from '$lib/types/lecture';

export const selectedLectures = $state<SelectedLecture[]>([]);

export function addLecture(catalog: CatalogEntry, detail: LectureDetail | null) {
    const exists = selectedLectures.some(
        l => l.catalog.id === catalog.id
    );
    if (!exists) {
        selectedLectures.push({
            catalog,
            detail,
            selectedModuleIndex: 0,
            included: true
        });
    }
}

export function removeLecture(catalogId: number) {
    const idx = selectedLectures.findIndex(l => l.catalog.id === catalogId);
    if (idx !== -1) selectedLectures.splice(idx, 1);
}

export function isSelected(catalogId: number): boolean {
    return selectedLectures.some(l => l.catalog.id === catalogId);
}
