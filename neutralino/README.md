# Vorlesungsplaner Desktop (Neutralino)

Diese App verpackt die bestehende, unveränderte SvelteKit-App (`adapter-node`)
in ein natives Fenster. Die komplette UI, alle `+server.ts`-Routen und die
gesamte Business-Logik bleiben exakt wie sie sind — es kommt nur eine
Verpackungsschicht hinzu.

## Architektur

```
Neutralino-Fenster (resources/index.html)
        │
        ├─ startet als Kindprozess: neutralino/server/server-<os>-x64(.exe)
        │  (= die bestehende SvelteKit-App, per `bun build --compile`
        │    zu einem eigenständigen Executable kompiliert)
        │
        └─ zeigt per <iframe> http://127.0.0.1:34981/ an,
           sobald der Server bereit ist
```

Warum ein iframe statt direkter Navigation? Damit die Verbindung zur
Neutralino-Laufzeit (für sauberes Beenden des Server-Prozesses beim
Schließen des Fensters) erhalten bleibt.

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

# Terminal 2: Neutralino-Fenster gegen den Dev-Server testen
#   (dazu in neutralino/resources/app.js den PORT temporär auf den
#    Vite-Dev-Port setzen, z.B. 5173, und den Kindprozess-Start
#    überspringen)
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
2. `bun build --compile` dreimal (Windows/macOS/Linux) →
   `neutralino/server/win-x64/server.exe`, `neutralino/server/mac-x64/server`,
   `neutralino/server/linux-x64/server` — jeweils mit einer Kopie von
   `build/client/` direkt daneben (siehe Hinweis unten, warum das nötig ist)
3. `neu build` → fertige Bundles in `neutralino/dist/vorlesungsplaner/`

Die drei Plattform-Ordner werden **alle** in jedes Distributions-Bundle
mitgepackt (Neutralino bündelt `resources/` und danebenliegende Dateien
1:1 für alle Zielplattformen). `app.js` wählt zur Laufzeit anhand von
`NL_OS` den richtigen Unterordner aus. Das kostet etwas Bundle-Größe (drei
Bun-Runtimes statt einer), vereinfacht den Build aber deutlich.

**Warum ein Ordner pro Plattform statt einer einzelnen Datei?**
`bun build --compile` bettet nur das ein, was über `import`-Statements
erreichbar ist. `adapter-node` liest seine statischen Client-Assets
(`build/client/` – die gebauten JS/CSS-Dateien fürs Frontend) zur Laufzeit
aber über normale Dateisystem-Pfade relativ zum eigenen Skriptstandort,
nicht über `import`. Im kompilierten Executable wären diese Dateien sonst
schlicht nicht vorhanden. Deshalb liegt neben jeder Binary eine Kopie von
`client/`, und der Server wird mit `cwd` auf genau diesen Ordner gestartet.

## Bekannte offene Punkte / Risiken

- **`better-sqlite3` unter `bun build --compile` noch nicht verifiziert.**
  Bun hat gute, aber nicht perfekte Kompatibilität mit nativen
  Node-Addons. Falls der kompilierte Server beim Start mit einem Fehler
  rund um `better_sqlite3.node` abstürzt: Umstieg auf `bun:sqlite`
  (Bun-eingebaut, keine native Abhängigkeit) in `src/lib/server/db.ts`.
  Die Datei ist bewusst der einzige Ort im Projekt, der `better-sqlite3`
  importiert – ein Wechsel bliebe lokal begrenzt.
- **Fester Port 34981** in `app.js` – bei Konflikt mit einem anderen
  lokalen Prozess müsste das dynamisch werden (z. B. Port 0 an den
  Server übergeben, tatsächlich gebundenen Port zurücklesen).
- **Kein Icon hinterlegt.** `neutralino/resources/icon.png` ergänzen und
  in `neutralino.config.json` unter `modes.window.icon` eintragen.
- **Erster Start nach Installation ist langsam** (Bun-Runtime pro
  Server-Binary muss vom Betriebssystem "aufgewärmt" werden) — ein
  Ladebildschirm ist bereits eingebaut (`#status`), aber die Wartezeit
  selbst lässt sich technisch kaum weiter verkürzen.
