import { Database } from "bun:sqlite";

export const db = new Database("data.db");

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
    hierarchy_key INTEGER UNIQUE,
    unibas_id INTEGER UNIQUE,
    course_number TEXT,
    title TEXT
);
`);
