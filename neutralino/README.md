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
        │  neutralino/server/<os>-x64/bun/bun(.exe)
        │      neutralino/server/<os>-x64/app/index.js --data-dir=...
        │  (= echter Bun-Interpreter + echtes, unverändertes
        │     adapter-node-Build-Verzeichnis)
        │
        └─ zeigt per <iframe> http://127.0.0.1:3000/ an,
           sobald der Server bereit ist
```

Warum ein iframe statt direkter Navigation? Damit die Verbindung zur
Neutralino-Laufzeit (für sauberes Beenden des Server-Prozesses beim
Schließen des Fensters) erhalten bleibt.

**Warum ein echter Bun-Interpreter statt einer kompilierten Binary?**
Ursprünglich wurde der Server per `bun build --compile` zu einer
eigenständigen Datei kompiliert. Das scheiterte aber strukturell: In einer
so kompilierten Binary liefern `import.meta.dir`/`__dirname` einen
**virtuellen** Pfad (z. B. `B:\~BUN\root\` unter Windows), nicht den
echten Ordner, in dem die Datei liegt — ein bekannter, bisher ungelöster
Bun-Bug ([#8476](https://github.com/oven-sh/bun/issues/8476),
[#16010](https://github.com/oven-sh/bun/issues/16010)). `adapter-node`
sucht seinen `client/`-Ordner aber genau relativ zu diesem Pfad, wodurch
alle `_app/immutable/*`-Assets mit 404 fehlschlugen. Mit einer echten
`app/index.js`-Datei, ausgeführt von einem echten `bun(.exe)`, funktioniert
die normale Pfadauflösung wieder wie erwartet.

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
2. Für jede Zielplattform (Windows/macOS/Linux):
   - lädt den offiziellen Bun-Release (`bun-<platform>.zip` von GitHub,
     gecacht unter `.bun-runtime-cache/` nach dem ersten Mal) herunter
     und entpackt den Interpreter nach `neutralino/server/<os>-x64/bun/`
   - kopiert das komplette `build/`-Verzeichnis unverändert nach
     `neutralino/server/<os>-x64/app/`
   - kopiert `node_modules` nach `neutralino/server/<os>-x64/app/node_modules/`
     (adapter-node bundelt keine Dependencies - ohne das crasht jeder
     API-Call, der z. B. `better-sqlite3` oder `cheerio` braucht, mit 500)
3. `neu build` → fertige Bundles in `neutralino/dist/vorlesungsplaner/`

Alle drei Plattform-Ordner werden **komplett** in jedes
Distributions-Bundle mitgepackt (das steuert `"copyItems": ["server"]`
in `neutralino.config.json` — ohne das kopiert `neu build` eigene Ordner
wie `server/` standardmäßig **nicht** mit!). `app.js` wählt zur Laufzeit
anhand von `NL_OS` den richtigen Unterordner aus. Das kostet etwas
Bundle-Größe (drei Bun-Runtimes statt einer), vereinfacht den Build aber
deutlich.

## Bekannte offene Punkte / Risiken

- **`better-sqlite3` ist plattformspezifisch kompiliert (native `.node`-Datei).**
  `node_modules` wird aktuell 1:1 vom Build-Rechner in **alle drei**
  Plattform-Ordner kopiert. Das funktioniert nur für die Plattform, auf
  der tatsächlich gebaut wird (hier: Windows) — für macOS/Linux wäre die
  mitkopierte `better-sqlite3`-Binary die falsche und der Server würde
  dort beim ersten DB-Zugriff crashen. Sauberer Fix: Umstieg auf
  `bun:sqlite` (in Bun eingebaut, keine native Kompilierung, für jede
  Plattform automatisch verfügbar) in `src/lib/server/db.ts` — die Datei
  ist bewusst der einzige Ort im Projekt, der `better-sqlite3` importiert,
  ein Wechsel bliebe lokal begrenzt. Bis dahin: nur die Windows-Variante
  ist verlässlich lauffähig.
- **Bundle-Größe:** `node_modules` wird pro Plattform dupliziert (3×),
  zusätzlich zu den 3 Bun-Runtimes. Für einen ersten funktionierenden
  Stand bewusst in Kauf genommen; ließe sich später optimieren (z. B. nur
  Production-Dependencies statt des kompletten `node_modules`
  mitkopieren).
- **Fester Port 3000** (adapter-node-Default) in `app.js` – bei Konflikt
  mit einem anderen lokalen Prozess müsste das konfigurierbar werden.
  `spawnProcess`/`execCommand` unterstützen laut aktueller Doku leider
  keine Umgebungsvariablen für den Kindprozess, daher aktuell nicht per
  `PORT`-Env lösbar; ggf. über einen zusätzlichen CLI-Parameter (analog
  zu `--data-dir`) nachrüstbar.
- **Kein Icon hinterlegt.** `neutralino/resources/icon.png` ergänzen und
  in `neutralino.config.json` unter `modes.window.icon` eintragen.
- **`.bun-runtime-cache/` gehört nicht ins Git** (siehe `.gitignore`) –
  bei Bedarf lokal löschen, um eine neuere Bun-Version zu erzwingen.
