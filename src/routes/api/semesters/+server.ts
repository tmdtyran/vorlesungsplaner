import { json } from "@sveltejs/kit";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "$lib/server/db";

export interface SemesterOption {
    periodeId: string;
    label_de: string;
    label_en: string;
}

const CACHE_PATH = join(DATA_DIR, "semesters.json");

function loadCache(): SemesterOption[] | null {
    try {
        if (existsSync(CACHE_PATH)) {
            return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
        }
    } catch {}
    return null;
}

async function fetchAndParse(): Promise<SemesterOption[]> {
    const headers = { "User-Agent": "Mozilla/5.0" };

    const [resDE, resEN] = await Promise.all([
        fetch("https://vorlesungsverzeichnis.unibas.ch/de/semesterprogramm", { headers }),
        fetch("https://vorlesungsverzeichnis.unibas.ch/en/semester-program", { headers }),
    ]);

    const [htmlDE, htmlEN] = await Promise.all([resDE.text(), resEN.text()]);

    function parseOptions(html: string): Map<string, string> {
        const map = new Map<string, string>();
        // Match <select name="periode">...</select>
        const selectMatch = html.match(/name=["']periode["'][^>]*>([\s\S]*?)<\/select>/i);
        if (!selectMatch) return map;
        const optionRegex = /<option[^>]+value=["'](\d+)["'][^>]*>([\s\S]*?)<\/option>/gi;
        let m: RegExpExecArray | null;
        while ((m = optionRegex.exec(selectMatch[1])) !== null) {
            map.set(m[1].trim(), m[2].replace(/&amp;/g, '&').trim());
        }
        return map;
    }

    const deMap = parseOptions(htmlDE);
    const enMap = parseOptions(htmlEN);

    // Merge by periodeId
    const allIds = new Set([...deMap.keys(), ...enMap.keys()]);
    const result: SemesterOption[] = [];

    for (const id of allIds) {
        result.push({
            periodeId: id,
            label_de: deMap.get(id) ?? enMap.get(id) ?? id,
            label_en: enMap.get(id) ?? deMap.get(id) ?? id,
        });
    }

    // Sort descending by periodeId (newest first)
    result.sort((a, b) => b.periodeId.localeCompare(a.periodeId));

    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2));
    return result;
}

// GET: return cached or fetch fresh
export async function GET({ url }) {
    const refresh = url.searchParams.get("refresh") === "1";
    if (!refresh) {
        const cached = loadCache();
        if (cached) return json(cached);
    }
    try {
        const semesters = await fetchAndParse();
        return json(semesters);
    } catch (err: any) {
        // If fetch fails but we have cache, return that
        const cached = loadCache();
        if (cached) return json(cached);
        return json({ error: err?.message ?? String(err) }, { status: 500 });
    }
}
