// LectureView.svelte is unmounted/remounted every time the user switches
// away from and back to the "Kursauswahl" tab (see +page.svelte, which uses
// {#if nav.activeTab === 'lectures'}). Any state declared with $state()
// inside that component is therefore lost on every tab switch. Keeping the
// UI state here instead — in a module-level store — means it simply
// survives the component being destroyed and recreated.
// Module-level (not component-level) so it survives LectureView being
// destroyed and recreated on every tab switch — otherwise switching away
// and back always forces a fresh async fetch, even for a (mode, semester)
// combination already loaded earlier in the session.
export const lectureCache = new Map<string, unknown>();

export const lectureViewState = $state({
    viewMode: 'flat' as 'flat' | 'hierarchy',
    searchLeft: '',
    expandedKeys: new Set<number>(),
    scrollTopFlat: 0,
    scrollTopHierarchy: 0,

    // Sort/filter dropdown to the right of the search field (flat "Liste" mode).
    // sortBy/sortDirection control ordering; weekdayFilter/typeFilter are
    // independent, always-visible filters (separate dropdowns, not modes).
    sortBy: 'alphabetical' as 'alphabetical' | 'credits',
    sortDirection: 'asc' as 'asc' | 'desc',
    weekdayFilter: new Set<string>(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Unregelmässig']),
    // null = not yet initialized from the loaded catalog; once the available
    // type_labels are known, this is populated with all of them (i.e. "all
    // checked" by default), matching weekdayFilter's default.
    typeFilter: null as Set<string> | null
});

