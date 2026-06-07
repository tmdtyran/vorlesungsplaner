import { importLecture } from "../src/lib/server/importer/unibas";
import {
    saveLecture,
    saveLectureEvent
} from "../src/lib/server/lectureRepository";

const lecture =
    await importLecture(301898);

const lectureId = saveLecture(
    lecture.unibasId,
    lecture.courseNumber,
    lecture.title
);

for (const event of lecture.events) {
    saveLectureEvent(
        lectureId,
        event.date,
        event.startTime,
        event.endTime,
        event.room
    );
}

console.log(
    `Imported ${lecture.events.length} events`
);
