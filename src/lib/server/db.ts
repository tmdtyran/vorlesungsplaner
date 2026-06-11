import { Database } from "bun:sqlite";

import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(
    path.join(dataDir, "data.db")
);

db.exec(`
CREATE TABLE IF NOT EXISTS lectures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    unibas_id INTEGER UNIQUE NOT NULL,

    title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lecture_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    lecture_id INTEGER NOT NULL,

    date TEXT NOT NULL,

    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,

    room TEXT,

    FOREIGN KEY (lecture_id)
      REFERENCES lectures(id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS lecture_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    hierarchy_key INTEGER UNIQUE NOT NULL,
    unibas_id INTEGER UNIQUE NOT NULL,

    course_number TEXT NOT NULL,
    title TEXT NOT NULL,

    credits REAL,
    lecturer TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS lecture_times (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    lecture_catalog_id INTEGER NOT NULL,

    frequency TEXT NOT NULL,
    weekday TEXT NOT NULL,

    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,

    FOREIGN KEY (lecture_catalog_id)
        REFERENCES lecture_catalog(id)
        ON DELETE CASCADE
);
`);
