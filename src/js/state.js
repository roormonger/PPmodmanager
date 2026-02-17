// Global State for PP Mod Manager

export const state = {
    currentMods: [],
    installedModsCache: [],
    installedModsList: [], // Enriched list for filtering
    nextCursor: "",
    contraptionsCache: [],
    contraptionsList: [], // Enriched list for filtering
    currentCollections: [],

    // Settings state (could be loaded from backend, but kept here for runtime cache)
    settings: {
        gamePath: "",
        apiKey: "",
        sortType: 3, // Trending
        sortDays: 7, // Week
        collSortType: 3, // Trending
        zoomLevel: 250,
        installedSortDir: "desc", // Default to newest first
        contraptionsSortDir: "desc"
    }
};

// Reset state helpers if needed
export function resetSearchState() {
    state.currentMods = [];
    state.nextCursor = "";
}
