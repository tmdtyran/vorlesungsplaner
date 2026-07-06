#!/usr/bin/env bun
/**
 * Baut den SvelteKit-Server (adapter-node) und kompiliert ihn per
 * `bun build --compile` fuer Windows/macOS/Linux zu eigenstaendigen
 * Executables (kein Node/Bun-Install beim Nutzer noetig).
 *
 * WICHTIG: `bun build --compile` bettet nur das ein, was ueber
 * `import`-Statements erreichbar ist. adapter-node liest seine
 * statischen Client-Assets (build/client/ - JS/CSS/Bilder fuers Frontend)
 * aber zur Laufzeit ueber normale Dateisystem-Pfade relativ zum eigenen
 * Skriptstandort, nicht ueber `import`. Deshalb kopieren wir build/client/
 * zusaetzlich NEBEN die kompilierte Binary (nicht hinein) und starten den
 * Prozess mit passendem cwd (siehe neutralino/resources/app.js).
 *
 * Ergebnis pro Plattform:
 *   neutralino/server/<platform>/server(.exe)
 *   neutralino/server/<platform>/client/...
 *
 * Nutzung: bun run build:desktop-server
 */
import { $ } from "bun";
import { mkdir, cp } from "node:fs/promises";

const OUT_DIR = "neutralino/server";

const targets = [
    { bunTarget: "bun-windows-x64", dir: "win-x64", binary: "server.exe" },
    { bunTarget: "bun-linux-x64", dir: "linux-x64", binary: "server" },
    { bunTarget: "bun-darwin-x64", dir: "mac-x64", binary: "server" }
];

async function main() {
    console.log("→ vite build (SvelteKit, adapter-node)…");
    await $`bun x vite build`;

    for (const { bunTarget, dir, binary } of targets) {
        const targetDir = `${OUT_DIR}/${dir}`;
        await mkdir(targetDir, { recursive: true });

        console.log(`→ bun build --compile --target=${bunTarget} → ${targetDir}/${binary}`);
        await $`bun build ./build/index.js --compile --target=${bunTarget} --outfile ${targetDir}/${binary}`;

        console.log(`→ kopiere build/client/ nach ${targetDir}/client/`);
        await cp("build/client", `${targetDir}/client`, { recursive: true });
    }

    console.log("\n✓ Server-Bundles fertig unter neutralino/server/<platform>/");
    console.log("  Weiter mit: cd neutralino && neu build");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

