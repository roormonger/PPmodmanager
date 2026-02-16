// Global State for PP Mod Manager

export const state = {
    currentMods: [],
    installedModsCache: [],
    nextCursor: "",
    contraptionsCache: [],
    currentCollections: [],

    // Settings state (could be loaded from backend, but kept here for runtime cache)
    settings: {
        gamePath: "",
        apiKey: "",
        sortType: 3, // Trending
        sortDays: 7, // Week
        collSortType: 3, // Trending
        zoomLevel: 250
    }
};

// Reset state helpers if needed
export function resetSearchState() {
    state.currentMods = [];
    state.nextCursor = "";
}
