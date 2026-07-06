// Loader-Logik der Neutralino-Shell.
//
// Ablauf:
// 1. Neutralino.init()
// 2. Freien Port waehlen und das gebuendelte Server-Binary (SvelteKit,
//    kompiliert via `bun build --compile`) als Kindprozess starten,
//    inkl. eines echten, plattformgerechten Datenverzeichnisses
//    (Neutralino.os.getPath('data')).
// 3. Warten, bis der Server auf dem Port antwortet (Polling).
// 4. Das Fenster per window.location.href zur echten App (SvelteKit-UI)
//    weiterleiten. Ab hier laeuft die bestehende App unveraendert -
//    alle fetch("/api/...")-Aufrufe der Komponenten gehen an genau
//    diesen lokalen Server.
// 5. Beim Schliessen des Fensters den Server-Kindprozess sauber beenden.

const PORT = 34981; // fester Port; bei Konflikt hier anpassen
const APP_NAME = "vorlesungsplaner";
const STARTUP_TIMEOUT_MS = 20000;

let serverProcess = null;

function setStatus(text) {
    const el = document.querySelector("#status p");
    if (el) el.textContent = text;
}

function setError(text) {
    const el = document.getElementById("error");
    if (el) el.textContent = text;
}

function serverPlatformDir() {
    // NL_OS: 'Windows', 'Linux', 'Darwin' (siehe Neutralino Doku).
    // Fuer macOS wird bewusst nur eine x64-Variante gebaut - Apple Silicon
    // fuehrt sie via Rosetta 2 transparent aus. Das spart uns eine
    // unzuverlaessige arm64/x64-Erkennung (Neutralinos computer.getArch()
    // meldet fuer beide Mac-Architekturen aktuell "x64", siehe Doku).
    if (NL_OS === "Windows") return { dir: "win-x64", binary: "server.exe" };
    if (NL_OS === "Darwin") return { dir: "mac-x64", binary: "server" };
    return { dir: "linux-x64", binary: "server" };
}

async function waitForServer(url, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url, { cache: "no-store" });
            // Jede Antwort (auch 404/500) heisst: der Prozess lebt und horcht.
            if (res.status < 600) return true;
        } catch (err) {
            // Verbindung noch nicht moeglich - weiter warten.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

async function startServer() {
    const dataDir = await Neutralino.os.getPath("data");
    const appDataDir = await Neutralino.filesystem.getJoinedPath(dataDir, APP_NAME);
    await Neutralino.filesystem.createDirectory(appDataDir).catch(() => {
        // existiert bereits - kein Problem
    });

    const { dir, binary } = serverPlatformDir();
    const platformDir = await Neutralino.filesystem.getJoinedPath(NL_PATH, "server", dir);
    const binPath = await Neutralino.filesystem.getJoinedPath(platformDir, binary);

    serverProcess = await Neutralino.os.spawnProcess(`"${binPath}"`, {
        cwd: platformDir,
        envs: {
            PORT: String(PORT),
            HOST: "127.0.0.1",
            VORLESUNGSPLANER_DATA_DIR: appDataDir,
            ORIGIN: `http://127.0.0.1:${PORT}`
        }
    });

    Neutralino.events.on("spawnedProcess", (evt) => {
        if (!serverProcess || evt.detail.id !== serverProcess.id) return;
        if (evt.detail.action === "stdErr") {
            console.error("[server]", evt.detail.data);
        }
        if (evt.detail.action === "exit") {
            console.log("[server] beendet mit Code", evt.detail.data);
        }
    });
}

async function main() {
    Neutralino.init();

    try {
        setStatus("Starte lokalen Server…");
        await startServer();

        setStatus("Warte auf Server…");
        const ready = await waitForServer(`http://127.0.0.1:${PORT}/`, STARTUP_TIMEOUT_MS);

        if (!ready) {
            setStatus("Server konnte nicht gestartet werden.");
            setError(
                "Der lokale Server hat innerhalb von " +
                    STARTUP_TIMEOUT_MS / 1000 +
                    " Sekunden nicht geantwortet."
            );
            return;
        }

        setStatus("Lade Oberfläche…");
        const frame = document.getElementById("app-frame");
        const statusEl = document.getElementById("status");
        frame.src = `http://127.0.0.1:${PORT}/`;
        frame.addEventListener(
            "load",
            () => {
                statusEl.style.display = "none";
                frame.style.display = "block";
            },
            { once: true }
        );
    } catch (err) {
        setStatus("Fehler beim Start.");
        setError(String(err && err.message ? err.message : err));
        console.error(err);
    }
}

Neutralino.events.on("windowClose", async () => {
    try {
        if (serverProcess) {
            await Neutralino.os.updateSpawnedProcess(serverProcess.id, "exit");
        }
    } catch (err) {
        // Prozess evtl. schon beendet - ignorieren
    } finally {
        Neutralino.app.exit();
    }
});

main();
