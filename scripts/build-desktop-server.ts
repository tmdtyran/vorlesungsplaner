#!/usr/bin/env bun
/**
 * Baut den SvelteKit-Server (adapter-node) und stellt ihn fuer
 * Windows/macOS/Linux bereit - inkl. eines echten, mitgelieferten
 * Bun-Interpreters (kein Node/Bun-Install beim Nutzer noetig).
 *
 * WICHTIG - warum kein `bun build --compile` mehr:
 * In einem via `bun build --compile` kompilierten Single-File-Executable
 * liefern `import.meta.dir`/`__dirname` einen VIRTUELLEN Pfad
 * (z.B. "B:\~BUN\root\" unter Windows, "/$bunfs/root/" unter Linux/Mac) -
 * NICHT den echten Ordner, in dem die .exe tatsaechlich liegt. Das ist ein
 * bekannter, bisher ungeloester Bun-Bug (oven-sh/bun#8476, #16010).
 * SvelteKits adapter-node sucht seinen client/-Ordner aber genau relativ
 * zu diesem dirname - das fuehrte bei uns zu durchgaengigen 404s fuer
 * alle _app/immutable/*-Assets, unabhaengig von cwd/Quoting/etc.
 *
 * Deshalb liefern wir jetzt statt einer kompilierten Datei:
 *   neutralino/server/<platform>/bun/bun(.exe)   - echter Bun-Interpreter
 *   neutralino/server/<platform>/app/            - echtes build/-Verzeichnis
 * und starten `bun/bun(.exe) app/index.js`. Da app/index.js eine ECHTE
 * Datei auf der Platte ist, funktioniert dirname-Aufloesung ganz normal.
 *
 * Nutzung: bun run build:desktop-server
 */
import { $ } from "bun";
import { mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT_DIR = "neutralino/server";
const CACHE_DIR = ".bun-runtime-cache";

const targets = [
    { bunTarget: "bun-windows-x64", dir: "win-x64", binaryName: "bun.exe" },
    { bunTarget: "bun-linux-x64", dir: "linux-x64", binaryName: "bun" },
    { bunTarget: "bun-darwin-x64", dir: "mac-x64", binaryName: "bun" }
];

async function downloadBunRuntime(bunTarget: string, destDir: string, binaryName: string) {
    const cachedZip = `${CACHE_DIR}/${bunTarget}.zip`;

    if (!existsSync(cachedZip)) {
        await mkdir(CACHE_DIR, { recursive: true });
        const url = `https://github.com/oven-sh/bun/releases/latest/download/${bunTarget}.zip`;
        console.log(`  ↓ lade ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status} (${url})`);
        await Bun.write(cachedZip, res);
    } else {
        console.log(`  ✓ ${bunTarget}.zip bereits im Cache (${CACHE_DIR}/)`);
    }

    const extractTmp = `${CACHE_DIR}/${bunTarget}-extracted`;
    await rm(extractTmp, { recursive: true, force: true });
    await mkdir(extractTmp, { recursive: true });

    if (process.platform === "win32") {
        await $`powershell -NoProfile -Command "Expand-Archive -Path '${cachedZip}' -DestinationPath '${extractTmp}' -Force"`;
    } else {
        await $`unzip -oq ${cachedZip} -d ${extractTmp}`;
    }

    // Das Zip enthaelt einen Ordner "bun-<target>/" mit der eigentlichen
    // Executable darin - wir suchen sie statt den Pfad hart zu kodieren.
    const glob = new Bun.Glob(`**/${binaryName}`);
    let foundPath: string | null = null;
    for await (const match of glob.scan({ cwd: extractTmp })) {
        foundPath = `${extractTmp}/${match}`;
        break;
    }
    if (!foundPath) throw new Error(`${binaryName} nicht im entpackten Archiv gefunden (${extractTmp})`);

    await mkdir(destDir, { recursive: true });
    await cp(foundPath, `${destDir}/${binaryName}`);
    if (process.platform !== "win32") {
        await $`chmod +x ${destDir}/${binaryName}`;
    }
}

async function main() {
    console.log("→ vite build (SvelteKit, adapter-node)…");
    await $`bun x vite build`;

    for (const { bunTarget, dir, binaryName } of targets) {
        const targetDir = `${OUT_DIR}/${dir}`;

        console.log(`→ Bun-Runtime für ${bunTarget}...`);
        await downloadBunRuntime(bunTarget, `${targetDir}/bun`, binaryName);

        console.log(`→ kopiere build/ nach ${targetDir}/app/`);
        await rm(`${targetDir}/app`, { recursive: true, force: true });
        await cp("build", `${targetDir}/app`, { recursive: true });

        // WICHTIG: adapter-node bundelt keine node_modules - es geht davon
        // aus, dass "node build/index.js" mit den echten node_modules aus
        // dem Projekt-Root daneben läuft. Ohne das crasht jeder API-Call,
        // der z.B. better-sqlite3 (db.ts) oder cheerio (Import-Scraper)
        // braucht, serverseitig mit 500. Deshalb kopieren wir node_modules
        // mit in den app/-Ordner.
        // ACHTUNG: better-sqlite3 enthält eine PLATTFORMSPEZIFISCH
        // kompilierte .node-Datei. Von diesem (Windows-)Rechner aus
        // gebaute node_modules funktionieren nur für win-x64 korrekt -
        // für linux-x64/mac-x64 bräuchte man node_modules, die tatsächlich
        // auf der jeweiligen Zielplattform installiert wurden (oder einen
        // Wechsel auf bun:sqlite, das ohne native Kompilierung auskommt).
        console.log(`→ kopiere node_modules nach ${targetDir}/app/node_modules/ (kann dauern)…`);
        await cp("node_modules", `${targetDir}/app/node_modules`, { recursive: true });
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
