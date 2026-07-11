#!/bin/sh
# Startet Vorlesungsplaner mit aktivierten Entwickler-Tools (DevTools).
# Fuer den Normalbetrieb bitte die normale Executable verwenden - nur
# dieses Skript (bzw. ein Alias/eine Verknuepfung darauf) aktiviert den
# Debug-Modus.
cd "$(dirname "$0")"
if [ -f "./vorlesungsplaner-mac_x64" ]; then
    ./vorlesungsplaner-mac_x64 --window-enable-inspector &
else
    ./vorlesungsplaner-linux_x64 --window-enable-inspector &
fi
