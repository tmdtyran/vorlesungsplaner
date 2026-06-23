import { json } from "@sveltejs/kit";
import { getAllLectures, getLecturesHierarchy } from "$lib/server/lectureRepository";

export async function GET({ url }) {
    const mode = url.searchParams.get("mode");
    if (mode === "hierarchy") {
        return json(getLecturesHierarchy());
    }
    return json(getAllLectures());
}
