import { json } from "@sveltejs/kit";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

function isDir(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export async function GET() {
    // Layout: DATA_DIR/<periodeId>/<lang>/lectures.db — one subfolder per
    // semester, one subfolder per language inside it.
    let periodeDirs: string[] = [];
    try {
        periodeDirs = readdirSync(DATA_DIR).filter(
            (name) => /^\d+$/.test(name) && isDir(join(DATA_DIR, name))
        );
    } catch {
        return json([]);
    }

    const entries: ImportStatusEntry[] = [];

    for (const periodeId of periodeDirs) {
        let langDirs: string[] = [];
        try {
            langDirs = readdirSync(join(DATA_DIR, periodeId)).filter(
                (name) => (name === "de" || name === "en") && isDir(join(DATA_DIR, periodeId, name))
            );
        } catch {
            continue;
        }

        for (const lang of langDirs) {
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
    }

    return json(entries);
}
