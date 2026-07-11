@echo off
REM Startet Vorlesungsplaner mit aktivierten Entwickler-Tools (DevTools).
REM Fuer den Normalbetrieb bitte die normale .exe verwenden - nur diese
REM Datei (bzw. eine Verknuepfung darauf) aktiviert den Debug-Modus.
cd /d "%~dp0"
start "" "vorlesungsplaner-win_x64.exe" --window-enable-inspector
