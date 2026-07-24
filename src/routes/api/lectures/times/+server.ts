import { json } from "@sveltejs/kit";
import { getResolvedCatalog } from "$lib/server/catalogResolver";

export async function GET({ url }) {
    const ids = url.searchParams.get("ids");
    const periodeId = url.searchParams.get("periodeId") ?? "default";
    const lang = url.searchParams.get("lang") ?? "de";

    if (!ids) return json([]);
    const idSet = new Set(ids.split(",").map(Number).filter(n => !isNaN(n)));
    if (idSet.size === 0) return json([]);

    const catalog = getResolvedCatalog(periodeId, lang);
    const rows: {
        lecture_catalog_id: number;
        weekday: string;
        start_time: string;
        end_time: string;
        frequency: string;
        title: string;
        unibas_id: number | null;
        credits: number | null;
    }[] = [];

    for (const entry of catalog) {
        if (!idSet.has(entry.id)) continue;
        const seen = new Set<string>();
        for (const slot of entry.timeSlots) {
            const key = `${slot.weekday}|${slot.start}|${slot.end}|${slot.frequency}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
                lecture_catalog_id: entry.id,
                weekday: slot.weekday,
                start_time: slot.start,
                end_time: slot.end,
                frequency: slot.frequency,
                title: entry.title,
                unibas_id: entry.unibas_id,
                credits: entry.credits
            });
        }
    }

    return json(rows);
}
