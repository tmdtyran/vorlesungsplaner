import { getDb } from "./db";

export interface CatalogLecture {
    id: number;
    hierarchy_key: number | null;
    unibas_id: number | null;
    course_number: string | null;
    title: string;
    type_label: string | null;
    credits: number | null;
    lecturer: string | null;
    parent_key: number | null;
    node_type: string | null;
    depth: number;
    schedule: string | null;
}

export interface RecurringTime {
    frequency: string | null;
    weekday: string;
    start_time: string;
    end_time: string;
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
    recurringTimes: RecurringTime[];
    modules: string[];
}

export interface LectureDetailEvent {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
}

// Correlated subquery producing a human-readable schedule summary
// (e.g. "wöchentlich Montag 16:15-18:00") for a given lecture_catalog row.
// DISTINCT guards against duplicate identical time-slot rows (e.g. from
// titles that repeat the same schedule markup twice).
const SCHEDULE_SUBQUERY = `(
    SELECT GROUP_CONCAT(sched, ' | ') FROM (
        SELECT DISTINCT
            TRIM(COALESCE(frequency || ' ', '') || weekday || ' ' || start_time || '-' || end_time) AS sched
        FROM lecture_times
        WHERE lecture_catalog_id = lecture_catalog.id
        ORDER BY weekday, start_time
    )
) AS schedule`;

export function getAllLectures(periodeId: string, lang: string): CatalogLecture[] {
    const db = getDb(periodeId, lang);
    // A lecture can be cross-listed under multiple faculties/programs and thus
    // appear at several hierarchy positions with the same unibas_id. The flat
    // "all lectures" list should show each real lecture only once — folders/
    // groups (unibas_id IS NULL) are left untouched since flat mode filters
    // those out client-side anyway.
    return db.prepare(`
        SELECT *, ${SCHEDULE_SUBQUERY} FROM lecture_catalog WHERE unibas_id IS NULL
        UNION ALL
        SELECT *, ${SCHEDULE_SUBQUERY} FROM lecture_catalog WHERE id IN (
            SELECT MIN(id) FROM lecture_catalog
            WHERE unibas_id IS NOT NULL
            GROUP BY unibas_id
        )
        ORDER BY title COLLATE NOCASE
    `).all() as CatalogLecture[];
}

export function getLecturesHierarchy(periodeId: string, lang: string): CatalogLecture[] {
    const db = getDb(periodeId, lang);
    return db.prepare(`
        SELECT *, ${SCHEDULE_SUBQUERY} FROM lecture_catalog ORDER BY hierarchy_key
    `).all() as CatalogLecture[];
}

export function getCatalogEntryByUnibasId(unibasId: number, periodeId: string, lang: string): CatalogLecture | null {
    const db = getDb(periodeId, lang);
    return db.prepare(`
        SELECT *, ${SCHEDULE_SUBQUERY} FROM lecture_catalog WHERE unibas_id = ? ORDER BY id LIMIT 1
    `).get(unibasId) as CatalogLecture | null;
}

// A lecture can be cross-listed under multiple hierarchy branches. For each
// placement, walk up parent_key to find ancestor nodes whose title marks a
// "Modul" (module) grouping — these are the modules the lecture can be
// assigned to. Uses a recursive CTE starting from every placement row.
function getModulesForLecture(db: ReturnType<typeof getDb>, unibasId: number): string[] {
    const rows = db.prepare(`
        WITH RECURSIVE ancestors(id, hierarchy_key, parent_key, title) AS (
            SELECT id, hierarchy_key, parent_key, title
            FROM lecture_catalog WHERE unibas_id = ?
            UNION ALL
            SELECT lc.id, lc.hierarchy_key, lc.parent_key, lc.title
            FROM lecture_catalog lc
            JOIN ancestors a ON lc.hierarchy_key = a.parent_key
        )
        SELECT DISTINCT title FROM ancestors
        WHERE title LIKE 'Modul:%' OR title LIKE 'Module:%'
        ORDER BY title
    `).all(unibasId) as { title: string }[];

    return rows.map(r => r.title.replace(/^Modul(e)?:\s*/i, "").trim());
}

function getRecurringTimesForLecture(db: ReturnType<typeof getDb>, unibasId: number): RecurringTime[] {
    return db.prepare(`
        SELECT DISTINCT lt.frequency, lt.weekday, lt.start_time, lt.end_time
        FROM lecture_times lt
        JOIN lecture_catalog lc ON lc.id = lt.lecture_catalog_id
        WHERE lc.unibas_id = ?
        ORDER BY lt.weekday, lt.start_time
    `).all(unibasId) as RecurringTime[];
}

export function getLectureDetail(unibasId: number, periodeId: string, lang: string): LectureDetail | null {
    const db = getDb(periodeId, lang);
    const detail = db.prepare(`
        SELECT id, unibas_id, course_number, title,
            language, semester, offered_by, faculty,
            lecturers, assessment_format, assessment_details, imported_at
        FROM lecture_details WHERE unibas_id = ?
    `).get(unibasId) as Omit<LectureDetail, 'events' | 'recurringTimes' | 'modules'> | undefined;

    const modules = getModulesForLecture(db, unibasId);
    const recurringTimes = getRecurringTimesForLecture(db, unibasId);

    if (!detail) {
        // No lecture_details row yet (details not imported), but we can
        // still surface modules/recurring times derived from the catalog.
        const catalogEntry = getCatalogEntryByUnibasId(unibasId, periodeId, lang);
        if (!catalogEntry) return null;
        return {
            id: catalogEntry.id,
            unibas_id: unibasId,
            course_number: catalogEntry.course_number,
            title: catalogEntry.title,
            language: null,
            semester: null,
            offered_by: null,
            faculty: null,
            lecturers: catalogEntry.lecturer,
            assessment_format: null,
            assessment_details: null,
            imported_at: null,
            events: [],
            recurringTimes,
            modules
        };
    }

    const events = db.prepare(`
        SELECT id, date, start_time, end_time, room
        FROM lecture_detail_events
        WHERE lecture_detail_id = ?
        ORDER BY date, start_time
    `).all(detail.id) as LectureDetailEvent[];

    return { ...detail, events, recurringTimes, modules };
}
