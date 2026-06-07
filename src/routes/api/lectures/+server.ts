import { json } from "@sveltejs/kit";
import { getAllLectures } from "$lib/server/lectureRepository";

export async function GET() {
    return json(getAllLectures());
}