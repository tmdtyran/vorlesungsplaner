import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

mkdirSync("data", { recursive: true });

export const db = new Database(join("data", "data.db"));

db.exec(`PRAGMA journal_mode = WAL;`);

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
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS lecture_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_catalog_id INTEGER NOT NULL,
    frequency TEXT,
    weekday TEXT,
    start_time TEXT,
    end_time TEXT,
    FOREIGN KEY (lecture_catalog_id)
        REFERENCES lecture_catalog(id)
        ON DELETE CASCADE
);
`);

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
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS lecture_detail_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecture_detail_id INTEGER NOT NULL,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    room TEXT,
    FOREIGN KEY (lecture_detail_id)
        REFERENCES lecture_details(id)
        ON DELETE CASCADE
);
`);

// Migrations for existing DBs
const catalogCols = db.prepare(`PRAGMA table_info(lecture_catalog)`).all() as any[];
const catalogExisting = new Set(catalogCols.map((c: any) => c.name));
const catalogAdditions: [string, string][] = [
    ["parent_key", "INTEGER"],
    ["node_type", "TEXT"],
    ["depth", "INTEGER DEFAULT 0"]
];
for (const [name, type] of catalogAdditions) {
    if (!catalogExisting.has(name)) {
        db.exec(`ALTER TABLE lecture_catalog ADD COLUMN ${name} ${type}`);
    }
}

const detailCols = db.prepare(`PRAGMA table_info(lecture_details)`).all() as any[];
const detailExisting = new Set(detailCols.map((c: any) => c.name));
const detailAdditions: [string, string][] = [
    ["language", "TEXT"],
    ["semester", "TEXT"],
    ["offered_by", "TEXT"],
    ["faculty", "TEXT"],
    ["lecturers", "TEXT"],
    ["assessment_format", "TEXT"],
    ["assessment_details", "TEXT"]
];
for (const [name, type] of detailAdditions) {
    if (!detailExisting.has(name)) {
        db.exec(`ALTER TABLE lecture_details ADD COLUMN ${name} ${type}`);
    }
}