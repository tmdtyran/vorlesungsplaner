export interface SemesterOption {
    periodeId: string;
    label_de: string;
    label_en: string;
}

export const activeSemester = $state<{ periodeId: string; lang: string }>({
    periodeId: "default",
    lang: "de"
});

export const availableSemesters = $state<SemesterOption[]>([]);

export function setActiveSemester(periodeId: string, lang: string) {
    activeSemester.periodeId = periodeId;
    activeSemester.lang = lang;
}

export function getLabel(s: SemesterOption, lang: string): string {
    return lang === "de" ? s.label_de : s.label_en;
}
