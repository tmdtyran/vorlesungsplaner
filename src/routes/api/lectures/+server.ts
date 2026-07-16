import { json } from "@sveltejs/kit";
import { getAllLectures, getLecturesHierarchy } from "$lib/server/lectureRepository";

// The catalog for a given semester practically never changes during normal
// use (only a manual re-import in the Import tab changes it), but the UI
// re-requests it every time the user switches between the flat and
// hierarchy views. A short TTL cache avoids re-running the (still
// non-trivial) catalog query on every such switch, while making sure a
// re-import is picked up again within a few minutes without needing any
// explicit cache-invalidation wiring.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET({ url }) {
    const mode = url.searchParams.get("mode");
    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    const cacheKey = `${mode}:${periodeId}:${lang}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return json(cached.data);
    }

    const data = mode === "hierarchy"
        ? getLecturesHierarchy(periodeId, lang)
        : getAllLectures(periodeId, lang);

    cache.set(cacheKey, { at: Date.now(), data });
    return json(data);
}