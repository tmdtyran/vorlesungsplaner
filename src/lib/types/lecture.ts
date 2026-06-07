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
