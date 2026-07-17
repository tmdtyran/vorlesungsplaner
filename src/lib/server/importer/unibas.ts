export async function fetchLectureHtml(
    unibasId: number,
    lang: "de" | "en" = "en"
): Promise<string> {

    const langPath = lang === "de" ? "de/vorlesungsverzeichnis" : "en/course-directory";

    let lastError: unknown;

    for (
        let attempt = 1;
        attempt <= 10;
        attempt++
    ) {

        try {

            const response =
                await fetch(
                    `https://vorlesungsverzeichnis.unibas.ch/${langPath}?id=${unibasId}`,
                    {
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0"
                        }
                    }
                );

            if (
                response.status === 429
            ) {

                const waitMs =
                    400 * attempt;

                console.log(
                    `RATE LIMITED ${unibasId} (${waitMs}ms)`
                );

                await Bun.sleep(
                    waitMs
                );

                continue;
            }

            if (
                !response.ok
            ) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const text = await response.text();

            // The server sometimes blocks us with a plain-text page like
            // "Access blocked due to abusive connection counts..." but
            // still answers with HTTP 200, so the checks above don't catch
            // it — without this, that block message gets stored as if it
            // were the real lecture page (and shows up later as "no fields
            // recognized" in the import debug view). Treat it exactly like
            // a 429: back off and retry.
            if (isBlockedResponse(text)) {

                const waitMs =
                    1500 * attempt;

                console.log(
                    `BLOCKED ${unibasId} (${waitMs}ms)`
                );

                await Bun.sleep(
                    waitMs
                );

                continue;
            }

            return text;

        } catch (error) {

            lastError =
                error;

            const waitMs =
                1000 * attempt;

            console.log(
                `RETRY ${attempt}/10 ${unibasId} (${waitMs}ms)`
            );

            await Bun.sleep(
                waitMs
            );
        }
    }

    throw lastError ?? new Error(`Blocked after 10 attempts for ${unibasId}`);
}

function isBlockedResponse(text: string): boolean {
    // Real lecture pages are large HTML documents; the block page is a
    // short plain-text message. Checking both the marker text and a rough
    // size/HTML-shape heuristic avoids false positives on legitimate pages
    // that might happen to mention similar words.
    if (text.length > 2000) return false;
    if (/<table[\s>]/i.test(text)) return false;
    return /abusive connection counts/i.test(text) || /access blocked/i.test(text);
}