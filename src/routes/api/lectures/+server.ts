import { json } from "@sveltejs/kit";
import { getAllLectures, getLecturesHierarchy } from "$lib/server/lectureRepository";
import { getCached, setCached } from "$lib/server/lecturesCache";

// The catalog for a given semester practically never changes during normal
// use (only a manual re-import in the Import tab changes it), but the UI
// re-requests it every time the user switches between the flat and
// hierarchy views. A short TTL cache avoids re-running the (still
// non-trivial) catalog query on every such switch. On top of the TTL, a
// fresh catalogue import explicitly invalidates the relevant entries (see
// lecturesCache.ts + the import route), so a re-import is reflected
// immediately rather than waiting out the TTL.

export async function GET({ url }) {
    const mode = url.searchParams.get("mode");
    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    const cached = getCached(mode, periodeId, lang);
    if (cached !== undefined) {
        return json(cached);
    }

    const data = mode === "hierarchy"
        ? getLecturesHierarchy(periodeId, lang)
        : getAllLectures(periodeId, lang);

    setCached(mode, periodeId, lang, data);
    return json(data);
}
