import { json } from "@sveltejs/kit";
import { getAllJobs } from "$lib/server/importJobs";

// Returns keys of all currently running jobs, so the status overview table
// can show a "in progress" (yellow) indicator for any semester/lang/action
// combo, even ones not currently selected in the dropdowns.
export async function GET() {
    const running = getAllJobs()
        .filter(j => j.status === "running")
        .map(j => ({ action: j.action, periodeId: j.periodeId, lang: j.lang }));
    return json(running);
}
