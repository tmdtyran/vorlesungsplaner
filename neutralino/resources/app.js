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

const PORT = 3000; // Server-Default (adapter-node) - kann nicht per env überschrieben werden, siehe unten
const APP_NAME = "vorlesungsplaner";
const STARTUP_TIMEOUT_MS = 20000;

let serverPid = null;
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
        try {
            // no-cors: uns interessiert nur "antwortet der Server überhaupt",
            // nicht der Inhalt der Antwort. Ohne no-cors blockt der Browser
            // die Cross-Origin-Anfrage (Loader läuft auf Neutralinos eigenem
            // Port, der Server auf einem anderen), da unser SvelteKit-Server
            // keine CORS-Header setzt (für die spätere App im <iframe>
            // braucht es das auch nicht - das läuft dann same-origin).
            await fetch(url, { cache: "no-store", mode: "no-cors" });
            return true; // kein Reject = Server hat geantwortet (Response bleibt opak)
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

    appendOutput(`Datenverzeichnis: ${appDataDir}`);
    appendOutput(`Starte: ${binPath}`);
    appendOutput(`Arbeitsverzeichnis: ${platformDir}`);
    appendOutput(`Zum manuellen Nachstellen: "${binPath}" --data-dir="${appDataDir}"`);

    // WICHTIG: os.spawnProcess UND os.execCommand mit cwd schienen
    // wiederholt fehlzuschlagen - der eigentliche Grund war aber viel
    // simpler: `neu build` kopiert eigene Ordner wie server/ standardmäßig
    // GAR NICHT ins dist-Bundle (nur resources/ und die Neutralino-eigenen
    // Binaries). NL_PATH zeigte daher zur Laufzeit auf einen Pfad, an dem
    // server.exe schlicht nicht existierte - das erklärt rückblickend alle
    // bisherigen Fehlerbilder. Fix: "copyItems": ["server"] in
    // neutralino.config.json. Jetzt, wo die Datei tatsächlich existiert,
    // funktioniert cwd wieder ganz normal.
    const result = await Neutralino.os.execCommand(
        `${binPath} --data-dir=${appDataDir}`,
        { cwd: platformDir, background: true }
    );

    serverPid = result.pid;
    appendOutput(`Prozess gestartet, PID: ${serverPid}`);

    // execCommand mit background:true liefert kein fortlaufendes
    // stdOut/stdErr wie spawnProcess' Events - wir verifizieren daher
    // ausschließlich über HTTP-Polling (waitForServer), ob der Server
    // tatsächlich antwortet.
}

async function main() {
    Neutralino.init();

    try {
        setStatus("Starte lokalen Server…");
        await startServer();

        setStatus("Warte auf Server…");
        const ready = await waitForServer(`http://127.0.0.1:${PORT}/`, STARTUP_TIMEOUT_MS);

        if (!ready) {
            setStatus("Server konnte nicht gestartet werden (Timeout).");
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
        if (serverPid) {
            const killCmd = NL_OS === "Windows" ? `taskkill /F /PID ${serverPid}` : `kill ${serverPid}`;
            await Neutralino.os.execCommand(killCmd).catch(() => {
                // Prozess evtl. schon beendet - ignorieren
            });
        }
    } catch (err) {
        // ignorieren - App soll in jedem Fall schliessen
    } finally {
        Neutralino.app.exit();
    }
});

main();

