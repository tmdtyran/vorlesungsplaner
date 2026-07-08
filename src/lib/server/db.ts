import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

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
const dbCache = new Map<string, Database.Database>();

export function getDb(periodeId: string, lang: string): Database.Database {
    const key = `${periodeId}_${lang}`;
    if (dbCache.has(key)) return dbCache.get(key)!;

    const db = new Database(join(DATA_DIR, `${key}.db`));
    db.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(db);
    dbCache.set(key, db);
    return db;
}

// Convenience: a "default" DB for when no semester is selected yet
let _defaultDb: Database.Database | null = null;
export function getDefaultDb(): Database.Database {
    if (_defaultDb) return _defaultDb;
    _defaultDb = new Database(join(DATA_DIR, "default.db"));
    _defaultDb.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(_defaultDb);
    return _defaultDb;
}

// Legacy export so existing imports still compile
export const db = getDefaultDb();

export function getImportMeta(db: Database.Database): Record<string, string> {
    const rows = db.prepare(`SELECT key, value FROM import_meta`).all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
}

export function setImportMeta(db: Database.Database, entries: Record<string, string>) {
    const stmt = db.prepare(`
        INSERT INTO import_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, value] of Object.entries(entries)) {
        stmt.run(key, value);
    }
}

export function clearImportMeta(db: Database.Database, keys: string[]) {
    const stmt = db.prepare(`DELETE FROM import_meta WHERE key = ?`);
    for (const key of keys) {
        stmt.run(key);
    }
}

function initSchema(db: Database.Database) {
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
    for (const [col, type] of [['parent_key','INTEGER'],['node_type','TEXT'],['depth','INTEGER DEFAULT 0'],['type_label','TEXT']] as [string,string][]) {
        if (!catalogCols.has(col)) db.exec(`ALTER TABLE lecture_catalog ADD COLUMN ${col} ${type}`);
    }
    const detailCols = new Set((db.prepare(`PRAGMA table_info(lecture_details)`).all() as any[]).map(c => c.name));
    for (const [col, type] of [['language','TEXT'],['semester','TEXT'],['offered_by','TEXT'],['faculty','TEXT'],['lecturers','TEXT'],['assessment_format','TEXT'],['assessment_details','TEXT']] as [string,string][]) {
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
                    depth INTEGER DEFAULT 0
                );
            `);
            const oldCols = new Set((db.prepare(`PRAGMA table_info(lecture_catalog_old)`).all() as any[]).map(c => c.name));
            const typeLabelSelect = oldCols.has('type_label') ? 'type_label' : 'NULL AS type_label';
            db.exec(`
                INSERT INTO lecture_catalog
                    (id, hierarchy_key, unibas_id, course_number, title, type_label, credits, lecturer, parent_key, node_type, depth)
                SELECT id, hierarchy_key, unibas_id, course_number, title, ${typeLabelSelect}, credits, lecturer, parent_key, node_type, depth
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
