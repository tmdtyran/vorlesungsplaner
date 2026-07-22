import { json } from "@sveltejs/kit";
import AdmZip from "adm-zip";
import { DATA_DIR, closeDbForImport } from "$lib/server/db";

// Imports one or more ZIP files selected via the native file picker in the
// Import tab. Each ZIP is expected to contain, directly at its root, one or
// more semester folders as they normally sit under data/ — e.g. zipping
// data/2026004 (and, for a multi-semester ZIP, data/2025005 alongside it)
// produces entries like "2026004/de/lectures.db", "2025005/en/lectures.db",
// etc. The ZIP's own filename is irrelevant (it can be anything, e.g.
// "abc.zip") — the periodeId(s) come purely from the top-level folder
// name(s) actually inside the archive. Extracting the whole archive
// straight into DATA_DIR reproduces that structure exactly, since every
// entry's path already starts with "<periodeId>/...".
export interface ZipImportResult {
    filename: string;
    periodeId: string;
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
        try {
            const buffer = Buffer.from(await file.arrayBuffer());
            const zip = new AdmZip(buffer);

            // Discover which semester(s) this ZIP actually contains by
            // looking at the first path segment of every entry, rather than
            // trusting the ZIP's filename — a single ZIP can bundle several
            // semester folders at once (e.g. "2026004/..." and
            // "2025005/..." both at the root).
            const periodeIds = new Set<string>();
            for (const entry of zip.getEntries()) {
                const first = entry.entryName.split("/")[0];
                if (PERIODE_ID_PATTERN.test(first)) periodeIds.add(first);
            }

            if (periodeIds.size === 0) {
                results.push({
                    filename: file.name,
                    periodeId: "?",
                    ok: false,
                    error: `Enthält keine Semester-Ordner im Root (erwartet z.B. "2026004/de/…").`
                });
                continue;
            }

            // Close any already-open connections for every semester this
            // ZIP touches, first — extracting on top of files bun:sqlite
            // still has open would otherwise leave the cache serving
            // stale/corrupted data (see closeDbForImport() in db.ts).
            for (const periodeId of periodeIds) {
                closeDbForImport(periodeId, "de");
                closeDbForImport(periodeId, "en");
            }

            // Entries already carry their full "<periodeId>/…" path, so
            // extracting straight into DATA_DIR reproduces exactly the
            // data/<periodeId>/<lang>/… layout used everywhere else.
            zip.extractAllTo(DATA_DIR, true); // true = overwrite existing files

            for (const periodeId of periodeIds) {
                results.push({ filename: file.name, periodeId, ok: true });
            }
        } catch (err: any) {
            results.push({
                filename: file.name,
                periodeId: "?",
                ok: false,
                error: err?.message ?? String(err)
            });
        }
    }

    return json({ results });
}
