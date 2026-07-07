// Loader-Logik der Neutralino-Shell.
//
// Ablauf:
// 1. Neutralino.init()
// 2. Freien Port waehlen und das gebuendelte Server-Binary (SvelteKit,
//    kompiliert via `bun build --compile`) als Kindprozess starten,
//    inkl. eines echten, plattformgerechten Datenverzeichnisses
//    (Neutralino.os.getPath('data')).
// 3. Warten, bis der Server auf dem Port antwortet (Polling).
// 4. Die App per <iframe> anzeigen. Ab hier laeuft die bestehende App
//    unveraendert - alle fetch("/api/...")-Aufrufe der Komponenten gehen
//    an genau diesen lokalen Server.
// 5. Beim Schliessen des Fensters den Server-Kindprozess sauber beenden.

const PORT = 3000; // DIAGNOSE 2: kein envs in diesem Test, Server nutzt Default-Port
const APP_NAME = "vorlesungsplaner";
const STARTUP_TIMEOUT_MS = 20000;

let serverProcess = null;
let serverExited = false;
let processOutput = "";

function setStatus(text) {
    const el = document.querySelector("#status p");
    if (el) el.textContent = text;
}

function setError(text) {
    const el = document.getElementById("error");
    if (el) el.textContent = text;
}

function appendOutput(line) {
    processOutput += line + "\n";
    setError(processOutput);
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

function toNativePath(path) {
    // Neutralino.filesystem.getJoinedPath liefert Pfade immer mit
    // Forward-Slashes zurueck, auch unter Windows. Als reines Argument
    // (z.B. cwd) verkraftet Windows das meistens, aber als der eigentliche
    // Executable-Pfad eines spawnProcess-Aufrufs fuehrte das bei uns zu
    // "Das System kann den angegebenen Pfad nicht finden." - vermutlich
    // weil der Befehl intern ueber cmd.exe interpretiert wird, das "/"
    // an dieser Stelle nicht zuverlaessig als Pfadtrenner behandelt.
    return NL_OS === "Windows" ? path.replace(/\//g, "\\") : path;
}

async function waitForServer(url, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (serverExited) return false; // Prozess ist schon tot - nicht weiter warten

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
    const platformDirRaw = await Neutralino.filesystem.getJoinedPath(NL_PATH, "server", dir);
    const binPathRaw = await Neutralino.filesystem.getJoinedPath(platformDirRaw, binary);
    const platformDir = toNativePath(platformDirRaw);
    const binPath = toNativePath(binPathRaw);

    appendOutput(`Starte: ${binPath}`);
    appendOutput(`Arbeitsverzeichnis: ${platformDir}`);

    // Sicherheitshalber die bestehende Prozessumgebung explizit übernehmen
    // und nur um unsere eigenen Variablen ergänzen - falls `envs` bei
    // spawnProcess die Elternumgebung ersetzt statt ergänzt, würden sonst
    // z.B. unter Windows Variablen wie SystemRoot fehlen, was zu stillen
    // Abstürzen bei der Netzwerk-/Socket-Initialisierung führen kann.
    const parentEnvs = await Neutralino.os.getEnvs().catch((err) => {
        appendOutput("getEnvs() fehlgeschlagen: " + String(err && err.message ? err.message : err));
        return {};
    });
    appendOutput(`Übernommene Umgebungsvariablen: ${Object.keys(parentEnvs).length}`);

    // WICHTIG: Listener MUSS vor spawnProcess registriert werden, sonst
    // verpassen wir stdOut/stdErr/exit-Events eines Prozesses, der sofort
    // nach dem Start abstuerzt (Race Condition).
    Neutralino.events.on("spawnedProcess", (evt) => {
        if (!serverProcess || evt.detail.id !== serverProcess.id) return;

        if (evt.detail.action === "stdOut") {
            appendOutput("[stdout] " + evt.detail.data);
        }
        if (evt.detail.action === "stdErr") {
            appendOutput("[stderr] " + evt.detail.data);
        }
        if (evt.detail.action === "exit") {
            serverExited = true;
            appendOutput(`[exit] Prozess beendet mit Code ${evt.detail.data}`);
        }
    });

    appendOutput(`[DIAGNOSE 3] Starte ganz ohne Optionen (Backslash-Pfad, kein cwd, kein envs)...`);
    serverProcess = await Neutralino.os.spawnProcess(binPath);

    appendOutput(`Prozess gestartet, PID/ID: ${serverProcess.id}`);
}

async function main() {
    Neutralino.init();

    try {
        setStatus("Starte lokalen Server…");
        await startServer();

        setStatus("Warte auf Server…");
        const ready = await waitForServer(`http://127.0.0.1:${PORT}/`, STARTUP_TIMEOUT_MS);

        if (!ready) {
            setStatus(
                serverExited
                    ? "Server ist vorzeitig beendet worden."
                    : "Server konnte nicht gestartet werden (Timeout)."
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
        appendOutput("Ausnahme: " + String(err && err.message ? err.message : err));
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

