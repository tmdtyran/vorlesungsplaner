import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

mkdirSync("data", {
    recursive: true
});

export const db = new Database(
    join("data", "data.db")
);

db.exec(`
PRAGMA journal_mode = WAL;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS lecture_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hierarchy_key INTEGER UNIQUE,
    unibas_id INTEGER UNIQUE,
    course_number TEXT,
    title TEXT,
    credits REAL,
    lecturer TEXT
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