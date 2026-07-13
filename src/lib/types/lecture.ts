export interface Lecture {
    id: number;
    unibasId: number;
    title: string;
    lecturers?: string;
    credits?: number;
}

export interface LectureEvent {
    id?: number;
    lectureId: number;
    date: string;
    startTime: string;
    endTime: string;
    room: string;
}

export interface CatalogEntry {
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

export interface DetailEvent {
    id: number;
    date: string;
    start_time: string;
    end_time: string;
    room: string;
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
    content: string | null;
    imported_at: string | null;
    events: DetailEvent[];
    recurringTimes: RecurringTime[];
    modules: string[];
}

export interface SelectedLecture {
    catalog: CatalogEntry;
    detail: LectureDetail | null;
    selectedModuleIndex: number;
    included: boolean;
}

export interface RecurringPatternRow {
    frequency: string;
    weekday: string;
    time: string;
    room: string;
}

export interface FullLectureDetails {
    unibasId: number;
    courseNumber: string | null;
    typeLabel: string | null;
    title: string;
    description: {
        semester: string | null;
        pattern: string | null;
        lecturers: string | null;
        content: string | null;
        learningObjectives: string | null;
        remarks: string | null;
    };
    admissionRequirements: {
        requirements: string | null;
        registration: string | null;
        language: string | null;
        digitalMedia: string | null;
    };
    datesAndRooms: {
        pattern: RecurringPatternRow[];
        sessions: DetailEvent[];
    };
    modules: string[];
    assessment: {
        format: string | null;
        details: string | null;
        registration: string | null;
        retake: string | null;
        scale: string | null;
        retakeOnFail: string | null;
        faculty: string | null;
        offeredBy: string | null;
    };
    debugRawHtmlSnippet?: string;
}
