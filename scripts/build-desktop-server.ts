#!/usr/bin/env bun
/**
 * Baut den SvelteKit-Server (adapter-node) zu einer einzigen, kleinen
 * Executable pro Zielplattform (Windows/macOS/Linux) - kein Bun/Node-Install
 * beim Nutzer noetig, kein separates node_modules, kein separater
 * Bun-Interpreter-Download.
 *
 * WARUM DAS SO FUNKTIONIERT (nach zwei gescheiterten Anläufen):
 *
 * 1. `bun build --compile` bettet alles ein, was über normale
 *    `import`-Statements erreichbar ist. adapter-nodes Server-Code
 *    (build/index.js + build/server/chunks/*.js) besteht komplett aus
 *    solchen Imports und laesst sich daher problemlos in eine einzige
 *    Datei kompilieren.
 *
 * 2. Der EINZIGE Teil, der zur Laufzeit echte Dateisystem-Pfade braucht,
 *    ist das Ausliefern der statischen Client-Assets (JS/CSS unter
 *    build/client/). adapter-node berechnet deren Basisverzeichnis in
 *    build/env.js via `path.dirname(fileURLToPath(import.meta.url))`.
 *    In einer kompilierten Bun-Executable liefert das aber einen
 *    VIRTUELLEN Pfad (z.B. "B:\~BUN\root\" unter Windows) statt des
 *    echten Speicherorts der Datei - ein bekannter, ungeloester Bun-Bug
 *    (oven-sh/bun#8476, #16010). Deshalb patchen wir diese eine Zeile in
 *    env.js so, dass sie stattdessen ein CLI-Flag (--assets-dir=...)
 *    respektiert, das wir beim Start mitgeben. Der Rest von adapter-node
 *    bleibt zu 100% unveraendert.
 *
 * 3. `better-sqlite3` (natives Modul, plattformspezifisch kompiliert)
 *    wurde durch `bun:sqlite` ersetzt (siehe src/lib/server/db.ts) - dadurch
 *    bündelt `bun build --compile` alle Abhängigkeiten sauber mit, ohne
 *    dass node_modules separat mitgeliefert werden muss.
 *
 * Ergebnis pro Plattform:
 *   neutralino/server/<platform>/vorlesungsplaner(.exe)   - eine Datei
 *   neutralino/server/<platform>/assets/client/           - nur die paar
 *                                                            KB an JS/CSS
 *
 * Nutzung: bun run build:desktop-server
 */
import { $ } from "bun";
import { mkdir, cp, rm } from "node:fs/promises";

const OUT_DIR = "neutralino/server";
const ENV_JS_PATH = "build/env.js";

const targets = [
    { bunTarget: "bun-windows-x64", dir: "win-x64", binaryName: "vorlesungsplaner.exe" },
    { bunTarget: "bun-linux-x64", dir: "linux-x64", binaryName: "vorlesungsplaner" },
    { bunTarget: "bun-darwin-x64", dir: "mac-x64", binaryName: "vorlesungsplaner" }
];

/**
 * Patcht die generierte build/env.js so, dass `dir` (Basis für den
 * client/-Ordner) auch über ein --assets-dir=-CLI-Flag gesetzt werden kann,
 * statt sich ausschließlich auf import.meta.url zu verlassen.
 */
async function patchEnvJsForAssetsDirOverride() {
    const original = "const dir = path.dirname(fileURLToPath(import.meta.url));";
    let content = await Bun.file(ENV_JS_PATH).text();

    if (content.includes("__ASSETS_DIR_OVERRIDE_PATCH__")) {
        return; // schon gepatcht (sollte nach frischem `vite build` nicht vorkommen)
    }
    if (!content.includes(original)) {
        throw new Error(
            `Erwartete Zeile in ${ENV_JS_PATH} nicht gefunden - hat sich das ` +
                `generierte Format von @sveltejs/adapter-node geändert? ` +
                `Gesuchte Zeile: ${JSON.stringify(original)}`
        );
    }

    const patched = `// __ASSETS_DIR_OVERRIDE_PATCH__ (siehe scripts/build-desktop-server.ts)
const dir = (() => {
\tconst flag = '--assets-dir=';
\tconst arg = process.argv.find((a) => a.startsWith(flag));
\tif (arg) return arg.slice(flag.length);
\treturn path.dirname(fileURLToPath(import.meta.url));
})();`;

    content = content.replace(original, patched);
    await Bun.write(ENV_JS_PATH, content);
}

async function main() {
    console.log("→ vite build (SvelteKit, adapter-node)…");
    await $`bun x vite build`;

    console.log("→ patche build/env.js für --assets-dir-Override…");
    await patchEnvJsForAssetsDirOverride();

    for (const { bunTarget, dir, binaryName } of targets) {
        const targetDir = `${OUT_DIR}/${dir}`;
        await mkdir(targetDir, { recursive: true });

        console.log(`→ bun build --compile --target=${bunTarget} → ${targetDir}/${binaryName}`);
        await $`bun build ./build/index.js --compile --target=${bunTarget} --outfile ${targetDir}/${binaryName}`;

        console.log(`→ kopiere build/client/ nach ${targetDir}/assets/client/`);
        await rm(`${targetDir}/assets`, { recursive: true, force: true });
        await mkdir(`${targetDir}/assets`, { recursive: true });
        await cp("build/client", `${targetDir}/assets/client`, { recursive: true });
    }

    console.log("\n✓ Server-Bundles fertig unter neutralino/server/<platform>/");

    if (process.argv.includes("--skip-neu-build")) {
        console.log("  (--skip-neu-build gesetzt, überspringe `neu build`)");
        return;
    }

    console.log("→ neu build (Neutralino-Bundles für Win/Mac/Linux)…");
    await $`bunx neu build`.cwd("neutralino");
    console.log("\n✓ Fertig. Bundles liegen unter neutralino/dist/vorlesungsplaner/");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
