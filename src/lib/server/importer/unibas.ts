export async function fetchLectureHtml(
    unibasId: number
): Promise<string> {

    let lastError: unknown;

    for (
        let attempt = 1;
        attempt <= 10;
        attempt++
    ) {

        try {

            const response =
                await fetch(
                    `https://vorlesungsverzeichnis.unibas.ch/en/course-directory?id=${unibasId}`,
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

            return await response.text();

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

    throw lastError;
}