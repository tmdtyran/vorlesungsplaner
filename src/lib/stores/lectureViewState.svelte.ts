// LectureView.svelte is unmounted/remounted every time the user switches
// away from and back to the "Kursauswahl" tab (see +page.svelte, which uses
// {#if nav.activeTab === 'lectures'}). Any state declared with $state()
// inside that component is therefore lost on every tab switch. Keeping the
// UI state here instead — in a module-level store — means it simply
// survives the component being destroyed and recreated.
export const lectureViewState = $state({
    viewMode: 'flat' as 'flat' | 'hierarchy',
    searchLeft: '',
    expandedKeys: new Set<number>(),
    scrollTopFlat: 0,
    scrollTopHierarchy: 0
});
