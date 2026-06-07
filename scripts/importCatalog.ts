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

    const idMatch = html.match(/\?id=(\d+)/);

    if (!idMatch) {
        return false;
    }

    const unibasId = Number(idMatch[1]);

    const courseNumber = match[1];
    const title = match[2];

    db.prepare(`
        INSERT OR REPLACE INTO lecture_catalog
        (
            hierarchy_key,
            unibas_id,
            course_number,
            title
        )
        VALUES (?, ?, ?, ?)
    `).run(
        node.key,
        unibasId,
        courseNumber,
        title
    );

    console.log(
        unibasId,
        courseNumber,
        title
    );

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

        console.log(
            "DIR",
            "level=" + level,
            "key=" + child.key
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

    console.log(
        "ROOT",
        root.key
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
