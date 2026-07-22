import { json } from "@sveltejs/kit";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { DATA_DIR, closeDbForImport } from "$lib/server/db";

// Imports one or more semester ZIP files (e.g. "2026004.zip") selected via
// the native file picker in the Import tab. Each ZIP is expected to contain
// exactly what normally lives directly under data/<periodeId>/ — i.e. "de/"
// and/or "en/" subfolders with lectures.db (+ logs/) inside — which is what
// you get by simply right-click-compressing that folder in Explorer/Finder.
// The ZIP's filename (without extension) determines which periodeId it's
// extracted into; its contents overwrite whatever is already there for that
// semester, which is the intended "restore/distribute this semester's data"
// behaviour, not a merge.
export interface ZipImportResult {
    filename: string;
    periodeId: string | null;
    ok: boolean;
    error?: string;
}

const PERIODE_ID_PATTERN = /^\d+$/;

export async function POST({ request }) {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
        return json({ error: "Keine Dateien erhalten." }, { status: 400 });
    }

    const results: ZipImportResult[] = [];

    for (const file of files) {
        const periodeId = file.name.replace(/\.zip$/i, "");

        if (!PERIODE_ID_PATTERN.test(periodeId)) {
            results.push({
                filename: file.name,
                periodeId: null,
                ok: false,
                error: `Dateiname "${file.name}" ergibt keine gültige Semester-ID (erwartet z.B. "2026004.zip").`
            });
            continue;
        }

        try {
            const buffer = Buffer.from(await file.arrayBuffer());
            const zip = new AdmZip(buffer);

            // Close any already-open connections for this semester first —
            // extracting on top of a file bun:sqlite still has open would
            // otherwise leave the cache serving stale/corrupted data (see
            // closeDbForImport() in db.ts for details).
            closeDbForImport(periodeId, "de");
            closeDbForImport(periodeId, "en");

            const targetDir = join(DATA_DIR, periodeId);
            mkdirSync(targetDir, { recursive: true });
            zip.extractAllTo(targetDir, true); // true = overwrite existing files

            results.push({ filename: file.name, periodeId, ok: true });
        } catch (err: any) {
            results.push({
                filename: file.name,
                periodeId,
                ok: false,
                error: err?.message ?? String(err)
            });
        }
    }

    return json({ results });
}
