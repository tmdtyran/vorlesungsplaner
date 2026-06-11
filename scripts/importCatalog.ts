import * as cheerio from "cheerio";
import { db } from "../src/lib/server/db";

const PERIOD = "2026004";

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRoot() {
    const response = await fetch(
        `https://vorlesungsverzeichnis.unibas.ch/components/hierarchie.cfc` +
        `?method=getTree` +
        `&periodId=${PERIOD}` +
        `&hid=`
    );

    return await response.json();
}

async function getSubTree(parentId: number, level: number) {
    const url =
        `https://vorlesungsverzeichnis.unibas.ch/components/hierarchie.cfc` +
        `?method=getSubTree` +
        `&parentid=${parentId}` +
        `&level=${level}` +
        `&period=${PERIOD}` +
        `&hid=`;

        for (let attempt = 1; attempt <= 10; attempt++) {

            const response = await fetch(url);

            const text = await response.text();

            if (
                text.includes("Access blocked due to abusive connection counts")
            ) {
                console.log(
                    "RATE LIMITED",
                    parentId,
                    "attempt",
                    attempt
                );

                await sleep(3000);

                continue;
            }

            return JSON.parse(text);
        }

        throw new Error(
            `Failed after retries: ${parentId}`
        );
}

function saveCourse(node: any): boolean {
    const html = String(node.title ?? "");

    const idMatch = html.match(/\?id=(\d+)/);

    if (!idMatch) {
        return false;
    }

    const unibasId = Number(idMatch[1]);

    const $ = cheerio.load(html);

    const text = $.root()
        .text()
        .replace(/\s+/g, " ")
        .trim();

    const match = text.match(
        /^([0-9]{4,6}-[0-9]{2})\s*-\s*(.+?)\s*\(([0-9.,]+)\s*(?:CP|KP)\)/
    );

    if (!match) {
        return false;
    }

    const courseNumber = match[1];
    const title = match[2];

    const credits = Number(
        match[3].replace(",", ".")
    );

    const spanText = $("span")
        .text()
        .replace(/\s+/g, " ")
        .trim();

    let lecturer: string | null = null;

    if (spanText) {
        lecturer = spanText
            .split(
                /\s+-\s+|wöchentlich:|14-täglich:|monatlich:/
            )[0]
            .trim();

        if (
            !lecturer ||
            lecturer === "-" ||
            lecturer === "–"
        ) {
            lecturer = null;
        }

        if (
            lecturer?.includes("Termine und Räume")
        ) {
            lecturer = null;
        }
    }

    db.prepare(`
        INSERT INTO lecture_catalog
        (
            hierarchy_key,
            unibas_id,
            course_number,
            title,
            credits,
            lecturer
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(unibas_id)
        DO UPDATE SET
            hierarchy_key = excluded.hierarchy_key,
            course_number = excluded.course_number,
            title = excluded.title,
            credits = excluded.credits,
            lecturer = excluded.lecturer
    `).run(
        node.key,
        unibasId,
        courseNumber,
        title,
        credits,
        lecturer
    );

    const lecture = db.prepare(`
        SELECT id
        FROM lecture_catalog
        WHERE unibas_id = ?
    `).get(unibasId) as { id: number };

    db.prepare(`
        DELETE FROM lecture_times
        WHERE lecture_catalog_id = ?
    `).run(lecture.id);

    const scheduleRegex =
        /(wöchentlich|14-täglich|monatlich):\s*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\s+([0-9]{1,2}\.[0-9]{2})-([0-9]{1,2}\.[0-9]{2})/g;

    let scheduleMatch;

    while (
        (scheduleMatch = scheduleRegex.exec(spanText))
    ) {
        db.prepare(`
            INSERT INTO lecture_times
            (
                lecture_catalog_id,
                frequency,
                weekday,
                start_time,
                end_time
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            lecture.id,
            scheduleMatch[1],
            scheduleMatch[2],
            scheduleMatch[3],
            scheduleMatch[4]
        );
    }

    return true;
}

async function crawl(parentId: number, level: number) {
    const children = await getSubTree(parentId, level);

    for (const child of children) {

        if (saveCourse(child)) {
            continue;
        }

        const isFolder =
            child.folder === true ||
            child.folder === "true" ||
            child.lazy === true ||
            child.lazy === "true";

        if (!isFolder) {
            continue;
        }

        const folderName = cheerio
            .load(String(child.title ?? ""))
            .root()
            .text()
            .replace(/\s+/g, " ")
            .trim();

        console.log(
            "DIR",
            "level=" + level,
            "key=" + child.key,
            "name=" + folderName
        );

        await sleep(300);

        try {
            await crawl(
                Number(child.key),
                level + 1
            );
        } catch (err) {
            console.log(
                "CRAWL ERROR",
                child.key,
                err
            );
        }
    }
}

const roots = await getRoot();

for (const root of roots) {

    const rootName = cheerio
        .load(String(root.title ?? ""))
        .root()
        .text()
        .replace(/\s+/g, " ")
        .trim();

    console.log(
        "ROOT",
        root.key,
        rootName
    );

    await sleep(300);

    await crawl(
        Number(root.key),
        1
    );
}

const count = db.query(`
    SELECT COUNT(*) AS count
    FROM lecture_catalog
`).get();

console.log("");
console.log("======================================");
console.log("IMPORT FINISHED");
console.log(count);
console.log("======================================");
