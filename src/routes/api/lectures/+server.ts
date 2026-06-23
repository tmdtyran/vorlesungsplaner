import { json } from "@sveltejs/kit";
import { getAllLectures, getLecturesHierarchy } from "$lib/server/lectureRepository";

export async function GET({ url }) {
    const mode = url.searchParams.get("mode");
    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    if (mode === "hierarchy") {
        return json(getLecturesHierarchy(periodeId, lang));
    }
    return json(getAllLectures(periodeId, lang));
}