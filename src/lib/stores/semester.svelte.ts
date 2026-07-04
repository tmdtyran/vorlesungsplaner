export interface SemesterOption {
    periodeId: string;
    label_de: string;
    label_en: string;
}

const STORAGE_KEY = "vorlesungsplaner:activeSemester";

function readPersisted(): { periodeId: string; lang: string } {
    if (typeof localStorage === 'undefined') return { periodeId: "default", lang: "de" };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.periodeId && parsed?.lang) return parsed;
        }
    } catch {
        // ignore malformed storage
    }
    return { periodeId: "default", lang: "de" };
}

// Persisted across reloads/browser restarts, so closing the app and coming
// back later keeps showing the same semester (and therefore the same
// selection list, which is stored per periodeId).
export const activeSemester = $state<{ periodeId: string; lang: string }>(readPersisted());

export const availableSemesters = $state<SemesterOption[]>([]);

export function setActiveSemester(periodeId: string, lang: string) {
    activeSemester.periodeId = periodeId;
    activeSemester.lang = lang;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ periodeId, lang }));
        } catch {
            // storage unavailable — active semester just won't persist
        }
    }
}

export function getLabel(s: SemesterOption, lang: string): string {
    return lang === "de" ? s.label_de : s.label_en;
}
