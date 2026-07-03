import { json } from "@sveltejs/kit";
import { readdirSync } from "node:fs";
import { getDb, getImportMeta, DATA_DIR } from "$lib/server/db";

export interface ImportStatusEntry {
    periodeId: string;
    lang: string;
    catalogImportedAt: string | null;
    catalogLectureCount: number | null;
    lecturesImportedAt: string | null;
    lecturesSuccessCount: number | null;
    lecturesTotalCount: number | null;
}

export async function GET() {
    let files: string[] = [];
    try {
        files = readdirSync(DATA_DIR).filter(f => f.endsWith(".db") && f !== "default.db" && !f.includes("-wal") && !f.includes("-shm"));
    } catch {
        return json([]);
    }

    const entries: ImportStatusEntry[] = [];

    for (const file of files) {
        const match = file.match(/^(\d+)_(de|en)\.db$/);
        if (!match) continue;
        const [, periodeId, lang] = match;

        try {
            const db = getDb(periodeId, lang);
            const meta = getImportMeta(db);

            entries.push({
                periodeId,
                lang,
                catalogImportedAt: meta.catalog_imported_at ?? null,
                catalogLectureCount: meta.catalog_lecture_count ? parseInt(meta.catalog_lecture_count) : null,
                lecturesImportedAt: meta.lectures_imported_at ?? null,
                lecturesSuccessCount: meta.lectures_success_count ? parseInt(meta.lectures_success_count) : null,
                lecturesTotalCount: meta.lectures_total_count ? parseInt(meta.lectures_total_count) : null
            });
        } catch {
            // skip unreadable db files
        }
    }

    return json(entries);
}