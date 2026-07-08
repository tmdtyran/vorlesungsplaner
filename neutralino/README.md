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
3. `neu build` → fertige Bundles in `neutralino/dist/vorlesungsplaner/`

Alle drei Plattform-Ordner werden **komplett** in jedes
Distributions-Bundle mitgepackt (das steuert `"copyItems": ["server"]`
in `neutralino.config.json` — ohne das kopiert `neu build` eigene Ordner
wie `server/` standardmäßig **nicht** mit!). `app.js` wählt zur Laufzeit
anhand von `NL_OS` den richtigen Unterordner aus. Das kostet etwas
Bundle-Größe (drei Bun-Runtimes statt einer), vereinfacht den Build aber
deutlich.

## Bekannte offene Punkte / Risiken

- **`better-sqlite3` unter dem mitgelieferten Bun-Interpreter noch nicht
  verifiziert.** Sollte inzwischen unkritischer sein als bei der
  kompilierten Variante (echter Bun-Interpreter statt Single-File-Binary),
  aber falls der Server beim Start mit einem Fehler rund um
  `better_sqlite3.node` abstürzt: Umstieg auf `bun:sqlite` (Bun-eingebaut,
  keine native Abhängigkeit) in `src/lib/server/db.ts`. Die Datei ist
  bewusst der einzige Ort im Projekt, der `better-sqlite3` importiert –
  ein Wechsel bliebe lokal begrenzt.
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
