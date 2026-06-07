import { db } from "./db";

export function getAllLectures() {
    return db.query(`
        SELECT *
        FROM lectures
        ORDER BY title
    `).all();
}

export function saveLecture(
    unibasId: number,
    courseNumber: string,
    title: string
) {
    db.query(`
        INSERT OR IGNORE INTO lectures (
            unibas_id,
            title
        )
        VALUES (?, ?)
    `).run(
        unibasId,
        title
    );

    const lecture = db.query(`
        SELECT id
        FROM lectures
        WHERE unibas_id = ?
    `).get(unibasId) as { id: number };

    return lecture.id;
}

export function saveLectureEvent(
    lectureId: number,
    date: string,
    startTime: string,
    endTime: string,
    room: string
) {
    db.query(`
        INSERT INTO lecture_events (
            lecture_id,
            date,
            start_time,
            end_time,
            room
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        lectureId,
        date,
        startTime,
        endTime,
        room
    );
}
