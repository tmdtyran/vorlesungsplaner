export type Tab = 'import' | 'lectures' | 'details' | 'calendar' | 'modules';

export const nav = $state<{ activeTab: Tab; detailsUnibasId: number | null }>({
    activeTab: 'lectures',
    detailsUnibasId: null
});

export function goToDetails(unibasId: number) {
    nav.detailsUnibasId = unibasId;
    nav.activeTab = 'details';
}

export function setActiveTab(tab: Tab) {
    nav.activeTab = tab;
}
