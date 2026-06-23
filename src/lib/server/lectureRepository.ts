import { getDb } from "./db";

export interface CatalogLecture {
    id: number;
    hierarchy_key: number | null;
    unibas_id: number | null;
    course_number: string | null;
    title: string;
    credits: number | null;
    lecturer: string | null;
    parent_key: number | null;
    node_type: string | null;
    depth: number;
}

export interface LectureDetail {
    id: number;
    unibas_id: number;
    course_number: string | null;
    title: string;
    language: string | null;
    semester: string | null;
    offered_by: string | null;
    faculty: string | null;
    lecturers: string | null;
    assessment_format: string | null;
    assessment_details: string | null;
    imported_at: string | null;
    events: LectureDetailEvent[];
}

export interface LectureDetailEvent {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
}

export function getAllLectures(periodeId: string, lang: string): CatalogLecture[] {
    const db = getDb(periodeId, lang);
    return db.prepare(`SELECT * FROM lecture_catalog ORDER BY title COLLATE NOCASE`).all() as CatalogLecture[];
}

export function getLecturesHierarchy(periodeId: string, lang: string): CatalogLecture[] {
    const db = getDb(periodeId, lang);
    return db.prepare(`SELECT * FROM lecture_catalog ORDER BY hierarchy_key`).all() as CatalogLecture[];
}

export function getLectureDetail(unibasId: number, periodeId: string, lang: string): LectureDetail | null {
    const db = getDb(periodeId, lang);
    const detail = db.prepare(`
        SELECT id, unibas_id, course_number, title,
            language, semester, offered_by, faculty,
            lecturers, assessment_format, assessment_details, imported_at
        FROM lecture_details WHERE unibas_id = ?
    `).get(unibasId) as Omit<LectureDetail, 'events'> | undefined;

    if (!detail) return null;

    const events = db.prepare(`
        SELECT id, date, start_time, end_time, room
        FROM lecture_detail_events
        WHERE lecture_detail_id = ?
        ORDER BY date, start_time
    `).all(detail.id) as LectureDetailEvent[];

    return { ...detail, events };
}
