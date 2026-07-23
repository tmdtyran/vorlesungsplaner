# Vorlesungsplaner UniBasel

Ein Tool zur Planung des Studiensemesters an der Universität Basel: Vorlesungen
aus dem offiziellen Vorlesungsverzeichnis importieren, im Kalender einplanen,
Kollisionen erkennen und Kreditpunkte/Module im Blick behalten. Läuft als
Web-App im Browser oder gepackt als eigenständige Desktop-Anwendung.

## Funktionsübersicht

- **Import** — Semesterkatalog und einzelne Vorlesungsdetails direkt vom
  UniBasel-Vorlesungsverzeichnis abrufen. Läuft asynchron über eine
  Warteschlange (mit Pause/Fortsetzen und Fortschrittsanzeige), damit die
  App währenddessen nutzbar bleibt.
- **Kursauswahl** — Vorlesungen durchsuchen, filtern und sortieren
  (alphabetisch, nach Kreditpunkten, Wochentag, Typ) und für das eigene
  Semester auswählen.
- **Details** — Vollständige Angaben zu einer Vorlesung (Dozierende, Sprache,
  Prüfungsform, Termine, Räume) sowie ein Link ins offizielle Verzeichnis.
- **Kalender** — Wochenansicht aller ausgewählten Vorlesungen inklusive
  farblicher Kennzeichnung.
- **Module & KP** — Übersicht über belegte Module und gesammelte
  Kreditpunkte.
- **Mehrsprachigkeit** — Deutsch/Englisch umschaltbar, inklusive der
  Katalogdaten selbst (Sprache wird beim Import mit abgefragt).
- **Dark Mode** — umschaltbar über den Knopf oben rechts, Einstellung wird
  lokal gespeichert.

## Tech-Stack

- [SvelteKit](https://svelte.dev/docs/kit) mit Svelte 5 (Runes) und TypeScript
- [Bun](https://bun.sh) als Laufzeitumgebung und Paketmanager (`bun:sqlite`
  als Datenbank, kein separater DB-Server nötig)
- [Tailwind CSS v4](https://tailwindcss.com) für das Styling
- [Cheerio](https://cheerio.js.org) zum Parsen der importierten HTML-Seiten
- [Neutralino.js](https://neutralino.js.org) für das optionale
  Desktop-Packaging (siehe `neutralino/README.md`)

## Voraussetzungen

- [Bun](https://bun.sh) (empfohlen — die App nutzt `bun:sqlite` und einige
  Skripte sind als Bun-Skripte geschrieben)

## Erste Schritte

```sh
bun install
bun run dev
```

Die App ist danach unter `http://localhost:5173` erreichbar. Vorlesungsdaten
müssen zunächst über den **Import**-Tab in der App für das gewünschte
Semester/Sprache geladen werden — es sind keine Daten vorinstalliert.

## Verfügbare Skripte

| Befehl                       | Zweck                                                        |
|-------------------------------|---------------------------------------------------------------|
| `bun run dev`                 | Startet den Entwicklungsserver (Vite)                         |
| `bun run build`                | Erstellt einen Produktions-Build                              |
| `bun run preview`              | Startet den Produktions-Build lokal                           |
| `bun run check`                | Typprüfung + Svelte-Diagnostik (`svelte-check`)                |
| `bun run check:watch`          | Wie `check`, aber im Watch-Modus                              |
| `bun run lint`                 | Prettier- und ESLint-Prüfung                                  |
| `bun run format`               | Formatiert den Code mit Prettier                               |
| `bun run test` / `test:unit`   | Führt die Vitest-Tests aus                                     |
| `bun run dev:desktop`          | Startet die Neutralino-Desktop-Shell im Entwicklungsmodus       |
| `bun run build:desktop`        | Baut die Desktop-Version (Single-File-Server + Neutralino-App)  |
| `bun run build:desktop-server` | Baut nur den gepackten Server, ohne Neutralino neu zu bauen     |

## Datenhaltung

Jede Semester-/Sprachkombination wird in einer eigenen SQLite-Datei unter
`data/<periodeId>_<lang>.db` gespeichert (Ordner wird beim ersten Start
automatisch angelegt). Der Speicherort lässt sich überschreiben:

1. Umgebungsvariable `VORLESUNGSPLANER_DATA_DIR`
2. CLI-Flag `--data-dir=<pfad>`
3. Datei `datadir.txt` im Projekt-Root (eine Zeile mit dem Pfad)
4. Fallback: `./data`

## Projektstruktur (Auszug)

```
src/
├── routes/                    SvelteKit-Seiten & API-Routen (+server.ts)
│   └── api/
│       ├── lectures/          Lese-/Detail-Endpunkte für Vorlesungen
│       ├── import/            Import-Queue, Status, Logs, Datenexport
│       └── semesters/         Verfügbare Semester
└── lib/
    ├── components/            Svelte-Komponenten (LectureView, CalendarView, …)
    ├── stores/                Reaktiver Zustand (Runes-basiert, *.svelte.ts)
    ├── i18n/                  Übersetzungen (DE/EN)
    └── server/
        ├── db.ts              SQLite-Zugriff (bun:sqlite), Schema & Migrationen
        ├── importJobs.ts       Job-/Fortschritts-Tracking
        ├── importQueue.ts       Warteschlangen-Verwaltung für Imports
        ├── importRunners.ts     Eigentliche Import-Logik (Katalog & Details)
        └── importer/           HTML-Parsing & Fetch-Logik für das
                                 UniBasel-Vorlesungsverzeichnis
scripts/                        Eigenständige Bun-Skripte (Desktop-Build etc.)
neutralino/                     Desktop-Packaging (Neutralino.js)
```

## Desktop-Version

Die App kann zusätzlich als eigenständige Desktop-Anwendung (Windows/macOS/
Linux) gepackt werden, ohne Node/Bun-Installation beim Endnutzer. Details zur
Architektur und zum Build-Prozess stehen in
[`neutralino/README.md`](./neutralino/README.md).
