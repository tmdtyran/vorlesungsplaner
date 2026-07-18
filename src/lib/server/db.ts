import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Database as BunDatabase } from "bun:sqlite";
import { invalidateLecturesCache } from "./lecturesCache";

// WICHTIG: Umstieg von better-sqlite3 auf bun:sqlite (in Bun eingebaut,
// keine native .node-Kompilierung noetig). Gruende:
// 1. better-sqlite3 ist plattformspezifisch kompiliert - node_modules vom
//    Windows-Build-Rechner funktionierten nicht fuer macOS/Linux.
// 2. Fuer eine echte Single-File-Executable via `bun build --compile`
//    duerfen keine externen nativen Module noetig sein, sonst muss
//    node_modules zusaetzlich mitgeliefert werden (grosses Bundle).
// bun:sqlite bildet die better-sqlite3-API bewusst fast 1:1 nach
// (.exec/.prepare/.get/.all/.run), daher blieb der Rest dieser Datei
// weitgehend unveraendert.
//
// WICHTIG: "bun:sqlite" wird bewusst NICHT statisch importiert (der obige
// `import type` ist ein reiner Typ-Import, der zur Laufzeit komplett
// entfernt wird - unproblematisch). Ein echter `import { Database } from
// "bun:sqlite"` an dieser Stelle bricht SvelteKits Build-Zeit-"Analyse"-
// Schritt: der importiert alle Routen testweise in einem isolierten ECHTEN
// Node.js-Worker, um prerender-Faehigkeit zu pruefen - und zwar auch dann,
// wenn der Build selbst per `bun run build` gestartet wurde. Node kennt
// das "bun:"-Protokoll nicht und bricht mit ERR_UNSUPPORTED_ESM_URL_SCHEME
// ab. Deshalb laden wir bun:sqlite unten per dynamischem, mit
// `typeof Bun !== "undefined"` abgesichertem Import - der wird unter Node
// nie ausgefuehrt, /* @vite-ignore */ verhindert zusaetzlich, dass Vites
// Bundler den Import schon beim Bauen selbst aufzuloesen versucht.
// WICHTIG: Weder "typeof Bun !== 'undefined'" noch "process.versions.bun"
// sind zuverlaessig: Vites neuer ModuleRunner (ab Vite 6/8) fuehrt SSR-
// Module in einem eigenen Ausfuehrungskontext aus (ESModulesEvaluator),
// in dem globale Bun-spezifische Objekte nicht sichtbar sind - selbst
// wenn der Host-Prozess tatsaechlich per `bun run dev` gestartet wurde.
// Ein Check auf globale Variablen liefert dort also ein falsches
// Ergebnis, OBWOHL bun:sqlite an sich importierbar waere.
// Deshalb: nicht raten, sondern den Import einfach versuchen. Nur wenn
// der ECHTE Import von "bun:sqlite" fehlschlaegt (z.B. weil wir wirklich
// unter Node/SvelteKits Analyse-Worker laufen, wo "bun:"-URLs mit
// ERR_UNSUPPORTED_ESM_URL_SCHEME abgelehnt werden), greift der Stub.
let DatabaseCtor: new (path: string) => BunDatabase;
let isBun = true;
try {
    const mod = await import(/* @vite-ignore */ "bun:sqlite");
    DatabaseCtor = mod.Database;
} catch {
    isBun = false;
}
if (!isBun) {
    // Nur fuer SvelteKits Analyse-Schritt (siehe oben) - liefert ein
    // Stub, der NICHT still Erfolg vortaeuscht: jeder echte Aufruf
    // (exec/prepare/get/all/run) wirft sofort einen klaren Fehler, statt
    // wie frueher `undefined`/`[]`/`{changes:0}` zurueckzugeben. Der alte
    // stille No-Op-Stub fuehrte dazu, dass ein kompletter Katalog-Import
    // ohne jeden Fehler "erfolgreich" durchlief, obwohl NICHTS in die DB
    // geschrieben wurde (0 Vorlesungen, 0 Zeitslots am Ende) - schwer zu
    // debuggen, weil nirgends eine Exception auftauchte.
    const boom = () => {
        throw new Error(
            "db.ts: dynamischer Import von 'bun:sqlite' ist fehlgeschlagen. " +
            "Dieser Stub darf nur waehrend SvelteKits Build-Analyse-Schritt " +
            "greifen (dort laeuft ein echter Node.js-Worker, der das " +
            "'bun:'-Protokoll nicht kennt). Falls das hier zur echten " +
            "Laufzeit passiert: Server MUSS mit `bun` gestartet werden " +
            "(z.B. `bun run dev`), nicht mit `node`/`npm run dev`."
        );
    };
    DatabaseCtor = class {
        exec() { boom(); }
        prepare(): any { boom(); }
        close() {}
    } as unknown as new (path: string) => BunDatabase;
}

// Im Web-Betrieb (unveraendert) liegt "data/" relativ zum cwd des Servers.
// Fuer die Desktop-Verpackung (Neutralino) braucht der Server einen echten,
// garantiert beschreibbaren Nutzerdatenordner statt eines relativen Pfads
// (sonst wird ggf. versucht, unterhalb eines schreibgeschuetzten
// Installationsverzeichnisses zu schreiben).
//
// Neutralinos os.spawnProcess unterstuetzt (Stand aktueller Doku) leider
// KEINE Umgebungsvariablen fuer den Kindprozess (nur execCommand kann das).
// Ein Versuch, eine Konfigurationsdatei neben die Server-Binary zu
// schreiben, scheiterte zudem mit NE_FS_FILWRER (Installationsverzeichnisse
// sind zurecht nicht beschreibbar). Deshalb uebergibt
// neutralino/resources/app.js das Zielverzeichnis stattdessen als simples
// CLI-Argument beim Start, das wir hier ueber process.argv auslesen.
// VORLESUNGSPLANER_DATA_DIR bzw. die datadir.txt-Datei bleiben als
// zusaetzliche Wege bestehen (z.B. fuer andere Wrapper, die Env-Variablen
// oder beschreibbare Installationsordner unterstuetzen).
function resolveDataDir(): string {
    if (process.env.VORLESUNGSPLANER_DATA_DIR) {
        return process.env.VORLESUNGSPLANER_DATA_DIR;
    }

    // process.argv enthält im Web-Betrieb ("node build/index.js") normalerweise
    // [execPath, scriptPath, ...args] - ein rein positionelles Argument wäre
    // hier mehrdeutig mit dem Skriptpfad selbst. Deshalb ein eindeutiges Flag.
    const dataDirArg = process.argv.find((arg) => arg.startsWith("--data-dir="));
    if (dataDirArg) return dataDirArg.slice("--data-dir=".length);

    const datadirFile = "datadir.txt";
    if (existsSync(datadirFile)) {
        const configured = readFileSync(datadirFile, "utf-8").trim();
        if (configured) return configured;
    }
    return "data";
}

export const DATA_DIR = resolveDataDir();
mkdirSync(DATA_DIR, { recursive: true });

// The active DB is determined at request time via the semester/lang combo.
// We keep a cache of open Database instances to avoid reopening constantly.
const dbCache = new Map<string, BunDatabase>();

export function getDb(periodeId: string, lang: string): BunDatabase {
    const key = `${periodeId}_${lang}`;
    if (dbCache.has(key)) return dbCache.get(key)!;

    const db = new DatabaseCtor(join(DATA_DIR, `${key}.db`));
    db.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(db);
    dbCache.set(key, db);
    return db;
}

// Convenience: a "default" DB for when no semester is selected yet
let _defaultDb: BunDatabase | null = null;
export function getDefaultDb(): BunDatabase {
    if (_defaultDb) return _defaultDb;
    _defaultDb = new DatabaseCtor(join(DATA_DIR, "default.db"));
    _defaultDb.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(_defaultDb);
    return _defaultDb;
}

// Legacy export so existing imports still compile
export const db = getDefaultDb();

export function getImportMeta(db: BunDatabase): Record<string, string> {
    const rows = db.prepare(`SELECT key, value FROM import_meta`).all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
}

export function setImportMeta(db: BunDatabase, entries: Record<string, string>) {
    const stmt = db.prepare(`
        INSERT INTO import_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, value] of Object.entries(entries)) {
        stmt.run(key, value);
    }
}

export function clearImportMeta(db: BunDatabase, keys: string[]) {
    const stmt = db.prepare(`DELETE FROM import_meta WHERE key = ?`);
    for (const key of keys) {
        stmt.run(key);
    }
}

/**
 * Deletes the data for one part of the import (catalogue, or lecture
 * details/events) for a given periode+lang, and clears the matching
 * import_meta entries — used by the per-cell trash icon and by cancelling
 * a running import.
 */
export function clearImportedData(periodeId: string, lang: string, type: "catalogue" | "lectures") {
    const db = getDb(periodeId, lang);
    if (type === "catalogue") {
        db.exec(`DELETE FROM lecture_times`);
        db.exec(`DELETE FROM lecture_catalog`);
        clearImportMeta(db, ["catalog_imported_at", "catalog_node_count", "catalog_lecture_count"]);
    } else {
        db.exec(`DELETE FROM lecture_detail_events`);
        db.exec(`DELETE FROM lecture_details`);
        clearImportMeta(db, ["lectures_imported_at", "lectures_success_count", "lectures_total_count"]);
    }
    invalidateLecturesCache(periodeId, lang);
}

function initSchema(db: BunDatabase) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS lecture_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hierarchy_key INTEGER UNIQUE,
        unibas_id INTEGER,
        course_number TEXT,
        title TEXT,
        type_label TEXT,
        credits REAL,
        lecturer TEXT,
        parent_key INTEGER,
        node_type TEXT,
        depth INTEGER DEFAULT 0
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_lecture_catalog_unibas_id ON lecture_catalog(unibas_id);`);

    db.exec(`
    CREATE TABLE IF NOT EXISTS lecture_times (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lecture_catalog_id INTEGER NOT NULL,
        frequency TEXT,
        weekday TEXT,
        start_time TEXT,
        end_time TEXT,
        FOREIGN KEY (lecture_catalog_id) REFERENCES lecture_catalog(id) ON DELETE CASCADE
    );`);
    // SCHEDULE_SUBQUERY (lectureRepository.ts) looks up rows by
    // lecture_catalog_id for every single row returned from lecture_catalog
    // — without this index that's a full table scan of lecture_times per
    // catalog row, which dominates load time for the (large) hierarchy view.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_lecture_times_catalog_id ON lecture_times(lecture_catalog_id);`);

    db.exec(`
    CREATE TABLE IF NOT EXISTS lecture_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        unibas_id INTEGER UNIQUE,
        course_number TEXT,
        title TEXT,
        language TEXT,
        semester TEXT,
        offered_by TEXT,
        faculty TEXT,
        lecturers TEXT,
        assessment_format TEXT,
        assessment_details TEXT,
        content TEXT,
        raw_html TEXT,
        imported_at TEXT
    );`);

    db.exec(`
    CREATE TABLE IF NOT EXISTS lecture_detail_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lecture_detail_id INTEGER NOT NULL,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        room TEXT,
        FOREIGN KEY (lecture_detail_id) REFERENCES lecture_details(id) ON DELETE CASCADE
    );`);

    db.exec(`
    CREATE TABLE IF NOT EXISTS import_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );`);

    // Migrations
    const catalogCols = new Set((db.prepare(`PRAGMA table_info(lecture_catalog)`).all() as any[]).map(c => c.name));
    for (const [col, type] of [['parent_key','INTEGER'],['node_type','TEXT'],['depth','INTEGER DEFAULT 0'],['type_label','TEXT'],['schedule','TEXT']] as [string,string][]) {
        if (!catalogCols.has(col)) db.exec(`ALTER TABLE lecture_catalog ADD COLUMN ${col} ${type}`);
    }
    const detailCols = new Set((db.prepare(`PRAGMA table_info(lecture_details)`).all() as any[]).map(c => c.name));
    for (const [col, type] of [['language','TEXT'],['semester','TEXT'],['offered_by','TEXT'],['faculty','TEXT'],['lecturers','TEXT'],['assessment_format','TEXT'],['assessment_details','TEXT'],['content','TEXT']] as [string,string][]) {
        if (!detailCols.has(col)) db.exec(`ALTER TABLE lecture_details ADD COLUMN ${col} ${type}`);
    }

    // Migration: older DB files created lecture_catalog.unibas_id with a UNIQUE
    // constraint. That's wrong — a lecture can be cross-listed under multiple
    // faculties/programs in the tree, appearing at several hierarchy_keys with
    // the same unibas_id. A UNIQUE constraint there caused inserts to throw and
    // silently abort processing of entire sibling subtrees during catalog import.
    // If we detect the old constraint, rebuild the table without it.
    const tableSql = (db.prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='lecture_catalog'`
    ).get() as { sql: string } | undefined)?.sql ?? "";

    if (/unibas_id\s+INTEGER\s+UNIQUE/i.test(tableSql)) {
        db.exec("BEGIN TRANSACTION;");
        try {
            db.exec(`ALTER TABLE lecture_catalog RENAME TO lecture_catalog_old;`);
            db.exec(`
                CREATE TABLE lecture_catalog (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    hierarchy_key INTEGER UNIQUE,
                    unibas_id INTEGER,
                    course_number TEXT,
                    title TEXT,
                    type_label TEXT,
                    credits REAL,
                    lecturer TEXT,
                    parent_key INTEGER,
                    node_type TEXT,
                    depth INTEGER DEFAULT 0,
                    schedule TEXT
                );
            `);
            const oldCols = new Set((db.prepare(`PRAGMA table_info(lecture_catalog_old)`).all() as any[]).map(c => c.name));
            const typeLabelSelect = oldCols.has('type_label') ? 'type_label' : 'NULL AS type_label';
            const scheduleSelect = oldCols.has('schedule') ? 'schedule' : 'NULL AS schedule';
            db.exec(`
                INSERT INTO lecture_catalog
                    (id, hierarchy_key, unibas_id, course_number, title, type_label, credits, lecturer, parent_key, node_type, depth, schedule)
                SELECT id, hierarchy_key, unibas_id, course_number, title, ${typeLabelSelect}, credits, lecturer, parent_key, node_type, depth, ${scheduleSelect}
                FROM lecture_catalog_old;
            `);
            db.exec(`DROP TABLE lecture_catalog_old;`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_lecture_catalog_unibas_id ON lecture_catalog(unibas_id);`);
            db.exec("COMMIT;");
        } catch (err) {
            db.exec("ROLLBACK;");
            throw err;
        }
    }
}
