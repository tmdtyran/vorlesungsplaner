const STORAGE_KEY = "vorlesungsplaner:darkMode";

function readPersisted(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

export const darkMode = $state<{ enabled: boolean }>({ enabled: readPersisted() });

function applyToDocument(enabled: boolean) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', enabled);
}

// Apply immediately on module load so the correct theme is active before
// the first paint / any component mounts.
applyToDocument(darkMode.enabled);

export function setDarkMode(enabled: boolean) {
    darkMode.enabled = enabled;
    applyToDocument(enabled);
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(STORAGE_KEY, String(enabled));
        } catch {
            // storage unavailable — preference just won't persist
        }
    }
}

export function toggleDarkMode() {
    setDarkMode(!darkMode.enabled);
}
