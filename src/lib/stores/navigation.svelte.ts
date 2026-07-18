export type Tab = 'import' | 'lectures' | 'details' | 'calendar' | 'modules';

const PANEL_EXPANDED_KEY = 'vorlesungsplaner:selectedPanelExpanded';

function readPersistedExpanded(): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
        const raw = localStorage.getItem(PANEL_EXPANDED_KEY);
        return raw === null ? true : raw === '1';
    } catch {
        return true;
    }
}

export const nav = $state<{ activeTab: Tab; detailsUnibasId: number | null; selectedPanelExpanded: boolean }>({
    activeTab: 'lectures',
    detailsUnibasId: null,
    selectedPanelExpanded: readPersistedExpanded()
});

export function goToDetails(unibasId: number) {
    nav.detailsUnibasId = unibasId;
    nav.activeTab = 'details';
}

export function setActiveTab(tab: Tab) {
    nav.activeTab = tab;
}

export function setSelectedPanelExpanded(expanded: boolean) {
    nav.selectedPanelExpanded = expanded;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(PANEL_EXPANDED_KEY, expanded ? '1' : '0');
        } catch {
            // storage unavailable — state just won't persist across reloads
        }
    }
}
