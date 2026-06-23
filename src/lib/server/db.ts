import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

mkdirSync("data", { recursive: true });

// The active DB is determined at request time via the semester/lang combo.
// We keep a cache of open Database instances to avoid reopening constantly.
const dbCache = new Map<string, Database.Database>();

export function getDb(periodeId: string, lang: string): Database.Database {
    const key = `${periodeId}_${lang}`;
    if (dbCache.has(key)) return dbCache.get(key)!;

    const db = new Database(join("data", `${key}.db`));
    db.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(db);
    dbCache.set(key, db);
    return db;
}

// Convenience: a "default" DB for when no semester is selected yet
let _defaultDb: Database.Database | null = null;
export function getDefaultDb(): Database.Database {
    if (_defaultDb) return _defaultDb;
    _defaultDb = new Database(join("data", "default.db"));
    _defaultDb.exec(`PRAGMA journal_mode = WAL;`);
    initSchema(_defaultDb);
    return _defaultDb;
}

// Legacy export so existing imports still compile
export const db = getDefaultDb();

function initSchema(db: Database.Database) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS lecture_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hierarchy_key INTEGER UNIQUE,
        unibas_id INTEGER UNIQUE,
        course_number TEXT,
        title TEXT,
        credits REAL,
        lecturer TEXT,
        parent_key INTEGER,
        node_type TEXT,
        depth INTEGER DEFAULT 0
    );`);

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

    // Migrations
    const catalogCols = new Set((db.prepare(`PRAGMA table_info(lecture_catalog)`).all() as any[]).map(c => c.name));
    for (const [col, type] of [['parent_key','INTEGER'],['node_type','TEXT'],['depth','INTEGER DEFAULT 0']] as [string,string][]) {
        if (!catalogCols.has(col)) db.exec(`ALTER TABLE lecture_catalog ADD COLUMN ${col} ${type}`);
    }
    const detailCols = new Set((db.prepare(`PRAGMA table_info(lecture_details)`).all() as any[]).map(c => c.name));
    for (const [col, type] of [['language','TEXT'],['semester','TEXT'],['offered_by','TEXT'],['faculty','TEXT'],['lecturers','TEXT'],['assessment_format','TEXT'],['assessment_details','TEXT']] as [string,string][]) {
        if (!detailCols.has(col)) db.exec(`ALTER TABLE lecture_details ADD COLUMN ${col} ${type}`);
    }
}
