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
    scrollTopHierarchy: 0
});
