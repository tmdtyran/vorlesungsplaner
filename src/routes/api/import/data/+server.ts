import { json } from "@sveltejs/kit";
import { clearImportedData } from "$lib/server/db";
import { isRunning } from "$lib/server/importJobs";

// Deletes the data behind a single ✓/— cell in the import status table
// (catalogue or lecture details, for one periode+lang), used by the
// hover-trash-icon in the Import tab.
export async function POST({ request }) {
    const { type, periodeId, lang } = await request.json();

    if (type !== "catalogue" && type !== "lectures") {
        return json({ error: "Unbekannter Typ." }, { status: 400 });
    }
    if (!periodeId || !lang) {
        return json({ error: "periodeId und lang sind erforderlich." }, { status: 400 });
    }
    if (isRunning(type, periodeId, lang)) {
        return json({ error: "Import läuft gerade — zuerst abbrechen." }, { status: 409 });
    }

    clearImportedData(periodeId, lang, type);

    return json({ ok: true });
}
