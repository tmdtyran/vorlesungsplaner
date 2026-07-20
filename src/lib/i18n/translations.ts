import { activeSemester } from '$lib/stores/semester.svelte';

// Central UI translation dictionary. Keys are German source strings used
// throughout the app; values are the English equivalents. Call t(key) from
// any component — it reactively reflects the top-right language switcher
// (activeSemester.lang), which already drives semester labels and API
// requests, so no separate "UI language" concept is introduced.
const dict: Record<string, string> = {
    // +page.svelte
    'Kursauswahl': 'Course Selection',
    'Kalender': 'Calendar',
    'Module & KP': 'Modules & Credits',
    'Aktiv:': 'Active:',
    '— kein Semester —': '— no semester —',
    '— Import → Fetch Semesters —': '— Import → Fetch Semesters —',
    'Dunklen Modus aktivieren': 'Enable dark mode',
    'Hellen Modus aktivieren': 'Enable light mode',

    // LectureView.svelte
    'Liste': 'List',
    'Hierarchie': 'Hierarchy',
    'Vorlesungen suchen...': 'Search lectures...',
    'Laden…': 'Loading…',
    'Lädt…': 'Loading…',
    'Vorlesungen': 'lectures',
    'Keine Vorlesungen gefunden': 'No lectures found',
    'Details anzeigen': 'Show details',
    'Zur Liste hinzufügen': 'Add to list',
    'Aus Auswahl entfernen': 'Remove from selection',

    // SelectedLecturesPanel.svelte
    'Meine Auswahl': 'My Selection',
    'Vorlesungs-IDs kopieren': 'Copy lecture IDs',
    'Alle im Vorlesungsverzeichnis öffnen': 'Open all in course directory',
    'Einklappen': 'Collapse',
    'Suchen...': 'Search...',
    'Noch keine Vorlesungen ausgewählt.': 'No lectures selected yet.',
    'Keine Treffer.': 'No matches.',
    'Im Kalender anzeigen / bei Module & KP berücksichtigen': 'Show in calendar / include in Modules & Credits',
    'Entfernen': 'Remove',
    'Im Vorlesungsverzeichnis öffnen': 'Open in course directory',
    'Im Details-Tab öffnen': 'Open in Details tab',
    'Meine Auswahl anzeigen': 'Show My Selection',
    'Auswahl': 'Selection',

    // LectureMiniDetail.svelte
    'Weiteres': 'More',
    'Semester': 'Semester',
    'Sprache': 'Language',
    'Fakultät': 'Faculty',
    'Angeboten von': 'Offered by',
    'Dozierende': 'Lecturers',
    'Prüfungsform': 'Assessment format',
    'Regelmässigkeit': 'Recurrence',
    'Beschreibung': 'Description',
    'Keine Beschreibung vorhanden.': 'No description available.',
    'Keine Beschreibung verfügbar — führe "Import All Lectures" aus, um Details zu laden.': 'No description available — run "Import All Lectures" to load details.',

    // DetailsView.svelte
    'Teilnahmevoraussetzungen': 'Admission Requirements',
    'Termine und Räume': 'Dates and Rooms',
    'Module': 'Modules',
    'Leistungsüberprüfung': 'Assessment',
    'Kursnummer': 'Course number',
    'z.B. 65935-01': 'e.g. 65935-01',
    'Laden': 'Load',
    'Diese Vorlesung neu von der Quelle laden': 'Reload this lecture from the source',
    'Neu laden fehlgeschlagen.': 'Reload failed.',
    'Aus Meine Auswahl entfernen': 'Remove from My Selection',
    'Zu Meine Auswahl hinzufügen': 'Add to My Selection',
    'Bitte eine Kursnummer eingeben (z.B. 65935-01).': 'Please enter a course number (e.g. 65935-01).',
    'Gib eine Kursnummer ein, um alle Details zu sehen.': 'Enter a course number to see all details.',
    'Angebotsmuster': 'Offering pattern',
    'Inhalt': 'Content',
    'Lernziele': 'Learning objectives',
    'Literatur': 'Literature',
    'Weblink': 'Web link',
    'Bemerkungen': 'Remarks',
    '⚠ Debug: Rohes HTML (keine Felder erkannt)': '⚠ Debug: Raw HTML (no fields recognized)',
    'Es konnten keine Label/Wert-Paare auf dieser Seite erkannt werden. Kopiere den Ausschnitt unten und teile ihn, damit der Parser angepasst werden kann.':
        'No label/value pairs could be recognized on this page. Copy the snippet below and share it so the parser can be adjusted.',
    'Anmeldung zur Lehrveranstaltung': 'Registration for the course',
    'Unterrichtssprache': 'Language of instruction',
    'Einsatz digitaler Medien': 'Use of digital media',
    'Keine Angaben vorhanden.': 'No information available.',
    'Einzeltermine': 'Individual dates',
    'Datum': 'Date',
    'Zeit': 'Time',
    'Raum': 'Room',
    'Keine Termine vorhanden.': 'No dates available.',
    'Keinem Modul zugeordnet.': 'Not assigned to any module.',
    'Prüfung': 'Exam',
    'Hinweise zur Prüfung': 'Notes on the exam',
    'An-/Abmeldung zur Prüfung': 'Exam registration/deregistration',
    'Wiederholungsprüfung': 'Retake exam',
    'Skala': 'Scale',
    'Belegen bei Nichtbestehen': 'Enrollment if failed',
    'Zuständige Fakultät': 'Responsible faculty',
    'Anbietende Organisationseinheit': 'Offering organizational unit',

    // CalendarView.svelte
    'Typische Woche': 'Typical Week',
    'Spezifische Woche': 'Specific Week',
    'Heute': 'Today',
    '📤 ICS exportieren': '📤 Export ICS',
    'frei': 'free',
    'Im Kalender ausblenden': 'Hide in calendar',
    'Im Kalender anzeigen': 'Show in calendar',
    'Keine Vorlesungen ausgewählt. Wähle zuerst Vorlesungen in der Kursauswahl.': 'No lectures selected. First select lectures in Course Selection.',
    'Keine Vorlesung im Kalender sichtbar — aktiviere eine in "Meine Auswahl" oder blende sie in der Legende unten wieder ein.':
        'No lecture visible in the calendar — enable one in "My Selection" or unhide it in the legend below.',
    'KW': 'Week',
    'bis': 'to',

    // LectureView.svelte — sort/filter dropdown
    'Alphabetisch': 'Alphabetical',
    'Wochentage': 'Weekdays',
    'Vorlesungstyp': 'Lecture type',
    'Aufsteigend': 'Ascending',
    'Absteigend': 'Descending',
    'Sortieren nach': 'Sort by',
    'Alle': 'All',
    'Keine': 'None',
    'Unregelmässig': 'Irregular',

    // ModuleView.svelte
    'Vorlesung': 'Lecture',
    'KP': 'Credits',
    'Modul': 'Module',
    'Keine Vorlesungen ausgewählt.': 'No lectures selected.',
    'Alle ausgewählten Vorlesungen sind in "Meine Auswahl" deaktiviert.': 'All selected lectures are deactivated in "My Selection".',
    'Bei der KP-Berechnung berücksichtigen': 'Include in credit calculation',
    'KP pro Modul': 'Credits per module',
    'Keine eingeschlossenen Vorlesungen.': 'No included lectures.',
    'Gesamt KP': 'Total credits',
    'von': 'of',
    'eingeschlossen': 'included',
    'Freie Leistungen': 'Free Credits',

    // ImportView.svelte
    'Fetch Semesters': 'Fetch Semesters',
    'Deutsch': 'German',
    'Englisch': 'English',
    'Abbrechen': 'Cancel',
    'Import Catalogue': 'Import Catalogue',
    'Import All Lectures': 'Import All Lectures',
    'Import-Status': 'Import Status',
    '— pro Semester & Sprache': '— per semester & language',
    'DE Katalog': 'DE Catalog',
    'DE Details': 'DE Details',
    'EN Katalog': 'EN Catalog',
    'EN Details': 'EN Details',
    'Löschen': 'Delete',
    'Import läuft…': 'Import running…',
    'Noch nicht importiert': 'Not imported yet',
    'Import Log': 'Import Log',
    'läuft…': 'running…',
    'Bereit. Klicke "Fetch Semesters" und dann einen Import-Button.': 'Ready. Click "Fetch Semesters" and then an import button.',
    '— Erst "Fetch Semesters" klicken —': '— Click "Fetch Semesters" first —',
    'wirklich löschen? Das kann nicht rückgängig gemacht werden.': 'really delete? This cannot be undone.',
    'Löschen fehlgeschlagen.': 'Delete failed.',
    'Fehler beim Abbrechen:': 'Error while cancelling:',
    'Abgebrochen — Daten gelöscht.': 'Cancelled — data deleted.',
    'Fehler:': 'Error:',
    'Katalog DE': 'Catalog DE',
    'Katalog EN': 'Catalog EN',
    'Details DE': 'Details DE',
    'Details EN': 'Details EN',
    'Katalog': 'Catalog',
    'Alle Vorlesungen': 'All Lectures',
    'Kein Log vorhanden.': 'No log available.',
    'Warteschlange': 'Queue',
    'In Warteschlange': 'Queue it',
    'Katalog muss zuerst importiert oder eingereiht werden.': 'Catalogue must be imported or queued first.',
    'Warteschlange leer.': 'Queue is empty.',
    'Warteschlange pausiert': 'Queue paused',
    'Pausieren': 'Pause',
    'Fortsetzen': 'Resume',
    'wartet': 'waiting',
    'läuft': 'running',
    'pausiert': 'paused',
    'Fehler': 'error',
    'Nach oben': 'Move up',
    'Nach unten': 'Move down',

    // Shared / weekdays
    'Montag': 'Monday',
    'Dienstag': 'Tuesday',
    'Mittwoch': 'Wednesday',
    'Donnerstag': 'Thursday',
    'Freitag': 'Friday',
    'Samstag': 'Saturday',
    'Sonntag': 'Sunday',
    // Recurrence/frequency terms as scraped verbatim from the source page's
    // schedule table (e.g. "wöchentlich Montag 16:15-18:00"). These are
    // translated client-side as a fallback for lectures where only the DE
    // details were imported, so the calendar/details view still reads
    // naturally when the switcher is set to 'en'.
    'wöchentlich': 'weekly',
    'zweiwöchentlich': 'biweekly',
    '14-täglich': 'biweekly',
    'monatlich': 'monthly',
    'täglich': 'daily',
    'einmalig': 'one-time',
    'Einzeltermin': 'single date',
    'unregelmässig': 'irregular',
    'nach Vereinbarung': 'by arrangement',
    'Keine Vorlesung mit Kursnummer': 'No lecture found with course number',
    'gefunden.': 'found.',
    'nicht gefunden.': 'not found.',
};

// A few buttons/labels in the Import tab are authored in English in the
// source (they're technical action names), but should still flip to
// German when the switcher is set to 'de'. This is the reverse direction
// of `dict` above.
const enToDe: Record<string, string> = {
    'Fetch Semesters': 'Semester abrufen',
    'Import Catalogue': 'Katalog importieren',
    'Import All Lectures': 'Alle Vorlesungen importieren',
    'Katalog': 'Katalog',
    'Alle Vorlesungen': 'Alle Vorlesungen',
    'Kein Log vorhanden.': 'Kein Log vorhanden.',
};

// Free-text schedule strings (e.g. "wöchentlich Montag 16:15-18:00", built
// server-side from frequency + weekday + time) can't be looked up as a
// whole — translate word-by-word instead, replacing only the recurrence/
// weekday terms and leaving times/rooms untouched.
const scheduleTerms: Record<string, string> = {
    'wöchentlich': 'weekly',
    'zweiwöchentlich': 'biweekly',
    '14-täglich': 'biweekly',
    'monatlich': 'monthly',
    'täglich': 'daily',
    'einmalig': 'one-time',
    'Einzeltermin': 'single date',
    'unregelmässig': 'irregular',
    'Montag': 'Monday',
    'Dienstag': 'Tuesday',
    'Mittwoch': 'Wednesday',
    'Donnerstag': 'Thursday',
    'Freitag': 'Friday',
    'Samstag': 'Saturday',
    'Sonntag': 'Sunday',
};
const scheduleTermsPattern = new RegExp(
    Object.keys(scheduleTerms).sort((a, b) => b.length - a.length).join('|'),
    'g'
);

/**
 * Translate a free-text schedule string (frequency + weekday + time,
 * concatenated server-side) by swapping out known German recurrence and
 * weekday words when the active language is 'en'. Everything else in the
 * string (times, rooms) is left untouched.
 */
export function tSchedule(text: string): string {
    if (activeSemester.lang !== 'en' || !text) return text;
    return text.replace(scheduleTermsPattern, match => scheduleTerms[match] ?? match);
}

/**
 * Translate a UI string to the active language.
 * - Keys are normally the German source string: when the active language
 *   is 'en', they're looked up in `dict` (German -> English).
 * - A few keys are authored in English (see `enToDe`): when the active
 *   language is 'de', they're looked up there instead (English -> German).
 * In every other case the key itself is returned unchanged.
 * Reactive: re-evaluates whenever activeSemester.lang changes because
 * it's read inside the function body (Svelte 5 tracks the dependency
 * wherever it's called from a $derived / template expression).
 */
export function t(key: string): string {
    if (activeSemester.lang === 'en') {
        return dict[key] ?? key;
    }
    return enToDe[key] ?? key;
}
