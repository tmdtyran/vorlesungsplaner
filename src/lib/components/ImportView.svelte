<script lang="ts">
    let semester = $state("HS2025");
    let language = $state("de");
    let logs = $state<string[]>([]);
    let loading = $state(false);

    const semesters = ["HS2025", "FS2025", "HS2024", "FS2024", "HS2023"];

    async function runImport(action: "catalogue" | "lectures") {
        loading = true;
        logs = [`Starting ${action === "catalogue" ? "catalogue" : "lecture"} import...`];

        try {
            const response = await fetch("/api/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, semester, language })
            });

            const reader = response.body?.getReader();
            if (!reader) {
                logs = [...logs, "No stream available."];
                loading = false;
                return;
            }

            const decoder = new TextDecoder();
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const lines = decoder.decode(value).split("\n").filter(Boolean);
                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.log) logs = [...logs, parsed.log];
                    } catch {
                        logs = [...logs, line];
                    }
                }
            }
        } catch (err: any) {
            logs = [...logs, `Error: ${err?.message ?? err}`];
        }

        loading = false;
    }
</script>

<div class="flex h-full flex-col gap-6 p-6">
    <div class="flex items-center gap-4">
        <div class="flex flex-col gap-1">
            <label for="semester-select" class="text-xs font-medium text-slate-500 uppercase tracking-wide">Semester</label>
            <select
                id="semester-select"
                bind:value={semester}
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
                {#each semesters as s}
                    <option value={s}>{s}</option>
                {/each}
            </select>
        </div>

        <div class="flex flex-col gap-1">
            <label for="lang-select" class="text-xs font-medium text-slate-500 uppercase tracking-wide">Sprache</label>
            <select
                id="lang-select"
                bind:value={language}
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            >
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
            </select>
        </div>

        <div class="ml-auto flex gap-3">
            <button
                disabled={loading}
                onclick={() => runImport("catalogue")}
                class="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
                {#if loading}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                Import Catalogue
            </button>
            <button
                disabled={loading}
                onclick={() => runImport("lectures")}
                class="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
                {#if loading}
                    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                {/if}
                Import All Lectures
            </button>
        </div>
    </div>

    <div class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-slate-950 overflow-hidden">
        <div class="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
            <div class="h-2.5 w-2.5 rounded-full bg-red-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-yellow-500"></div>
            <div class="h-2.5 w-2.5 rounded-full bg-green-500"></div>
            <span class="ml-2 text-xs text-slate-500 font-mono">Import Log</span>
        </div>
        <div class="flex-1 overflow-y-auto p-4 font-mono text-sm">
            {#if logs.length === 0}
                <p class="text-slate-600">Bereit. Starte einen Import um Logs zu sehen.</p>
            {:else}
                {#each logs as log}
                    <p class="text-slate-300 leading-6
                        {log.startsWith('✓') ? 'text-emerald-400' : ''}
                        {log.startsWith('✗') ? 'text-red-400' : ''}
                        {log.startsWith('Fatal') ? 'text-red-400 font-semibold' : ''}
                    ">{log}</p>
                {/each}
            {/if}
        </div>
    </div>
</div>
