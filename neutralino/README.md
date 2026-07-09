# Vorlesungsplaner Desktop (Neutralino)

Diese App verpackt die bestehende, unveränderte SvelteKit-App (`adapter-node`)
in ein natives Fenster. Die komplette UI, alle `+server.ts`-Routen und die
gesamte Business-Logik bleiben exakt wie sie sind — es kommt nur eine
Verpackungsschicht hinzu.

## Architektur

```
Neutralino-Fenster (resources/index.html)
        │
        ├─ startet als Kindprozess:
        │  neutralino/server/<os>-x64/vorlesungsplaner(.exe)
        │      --data-dir=<Nutzerdatenordner>
        │      --assets-dir=<...>/assets
        │  (= EINE kompilierte Datei, ~60-90 MB, kein separates
        │     node_modules, kein separater Bun-Interpreter)
        │
        └─ zeigt per <iframe> http://127.0.0.1:3000/ an,
           sobald der Server bereit ist
```

Warum ein iframe statt direkter Navigation? Damit die Verbindung zur
Neutralino-Laufzeit (für sauberes Beenden des Server-Prozesses beim
Schließen des Fensters) erhalten bleibt.

## Wie aus adapter-node eine echte Single-File-Executable wurde

Das war der schwierigste Teil und hat mehrere Anläufe gebraucht - kurz
dokumentiert, falls hier mal wieder etwas kaputtgeht:

1. **`bun build --compile` bettet alles ein, was über `import` erreichbar
   ist.** adapter-nodes Server-Code (`build/index.js` +
   `build/server/chunks/*.js`) besteht komplett aus solchen Imports und
   lässt sich daher problemlos in eine Datei kompilieren.
2. **Der einzige Teil, der einen echten Dateisystem-Pfad braucht, ist die
   Auslieferung der statischen Client-Assets** (`build/client/`).
   adapter-node berechnet deren Basisverzeichnis in `build/env.js` via
   `path.dirname(fileURLToPath(import.meta.url))`. In einer kompilierten
   Bun-Executable liefert das einen **virtuellen** Pfad statt des echten
   Speicherorts — ein bekannter, ungelöster Bun-Bug
   ([oven-sh/bun#8476](https://github.com/oven-sh/bun/issues/8476),
   [#16010](https://github.com/oven-sh/bun/issues/16010)).
3. **Fix:** `scripts/build-desktop-server.ts` patcht diese eine Zeile in
   `build/env.js` nach jedem `vite build`, sodass sie zusätzlich ein
   `--assets-dir=`-CLI-Flag respektiert. Der Rest von adapter-node bleibt
   zu 100 % unverändert. Der Patch wurde gegen den echten generierten Code
   verifiziert (nicht nur angenommen).
4. **`better-sqlite3` → `bun:sqlite`:** `better-sqlite3` ist plattform-
   spezifisch kompiliert (native `.node`-Datei) und hätte node_modules
   zusätzlich zur kompilierten Executable nötig gemacht. `bun:sqlite` ist
   in Bun eingebaut, braucht keine native Kompilierung und funktioniert
   automatisch auf allen 3 Plattformen. Die API ist bewusst fast 1:1 zu
   better-sqlite3, daher blieb `src/lib/server/db.ts` bis auf den Import
   unverändert. **Das Projekt läuft dadurch nur noch unter Bun**, nicht
   mehr unter reinem Node — passt zum bestehenden Tooling (`bun run ...`
   überall).

Ergebnis: `neutralino/server/<platform>/vorlesungsplaner(.exe)` (eine
Datei) + `neutralino/server/<platform>/assets/client/` (nur die paar KB
an JS/CSS, lose Dateien, da genau dafür `--assets-dir` existiert).

## Einmalige Einrichtung

`@neutralinojs/neu` ist bereits als devDependency in `package.json` eingetragen,
kein globales Install nötig.

```bash
bun install
cd neutralino
bunx neu update
cd ..
```

(Unter Windows/PowerShell funktioniert das genauso — nur `&&`-Verkettung
in einer Zeile unterstützen ältere PowerShell-Versionen nicht. Einfach
jeden Befehl einzeln bzw. mit Zeilenumbruch ausführen, wie oben gezeigt.)

## Entwickeln

```bash
# Terminal 1: SvelteKit-Dev-Server wie gewohnt
bun run dev

# Terminal 2: Neutralino-Fenster testen
bun run dev:desktop
```

Für den normalen Alltag reicht `bun run dev` im Browser – die
Neutralino-Hülle muss nur getestet werden, wenn sich an der Verpackung
selbst etwas ändert.

## Production-Build (alle 3 Desktop-Plattformen in einem Schritt)

```bash
bun run build:desktop
```

Das macht:
1. `vite build` (SvelteKit → `build/`, via `adapter-node`)
2. Patcht `build/env.js` für das `--assets-dir`-Flag (siehe oben)
3. Für jede Zielplattform (Windows/macOS/Linux):
   `bun build --compile` → eine einzelne Executable
   + Kopie von `build/client/` nach `assets/client/`
4. `neu build` → fertige Bundles in `neutralino/dist/vorlesungsplaner/`

Alle drei Plattform-Ordner werden **komplett** in jedes
Distributions-Bundle mitgepackt (das steuert `"copyItems": ["server"]`
in `neutralino.config.json` — ohne das kopiert `neu build` eigene Ordner
wie `server/` standardmäßig **nicht** mit!). `app.js` wählt zur Laufzeit
anhand von `NL_OS` den richtigen Unterordner aus.

## Bekannte offene Punkte / Risiken

- **Fester Port 3000** (adapter-node-Default) in `app.js` – bei Konflikt
  mit einem anderen lokalen Prozess müsste das konfigurierbar werden.
  `execCommand` unterstützt laut aktueller Doku leider keine
  Umgebungsvariablen für den Kindprozess, daher aktuell nicht per
  `PORT`-Env lösbar; ggf. über einen zusätzlichen CLI-Parameter (analog
  zu `--data-dir`/`--assets-dir`) nachrüstbar.
- **Kein Icon hinterlegt.** `neutralino/resources/icon.png` ergänzen und
  in `neutralino.config.json` unter `modes.window.icon` eintragen.
- **`db.ts`-Patch-Ziel könnte bei einem zukünftigen `adapter-node`-Update
  brechen.** Das Build-Skript wirft in dem Fall einen klaren Fehler
  ("Erwartete Zeile in build/env.js nicht gefunden") statt still zu
  scheitern — dann muss der Patch-String in
  `scripts/build-desktop-server.ts` an die neue generierte Form angepasst
  werden.
