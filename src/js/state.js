// Global State for PP Mod Manager

export const state = {
    currentMods: [],
    installedModsCache: [],
    installedModsList: [], // Enriched list for filtering
    nextCursor: "",
    contraptionsCache: [],
    contraptionsList: [], // Enriched list for filtering
    currentCollections: [],
    currentCollectionItems: [], // Items in the currently viewed collection

    // Settings state (could be loaded from backend, but kept here for runtime cache)
    settings: {
        gamePath: "",
        apiKey: "",
        steamcmdPath: "",
        version: "",
        sortType: 3, // Trending/Browse
        sortDays: 7, // Week
        browseTags: [],
        browseSortDir: "desc",
        collSortType: 3,
        collSortDays: 7,
        collSortDir: "desc",
        zoomLevel: 250,
        installedSortBy: "date",
        installedSortDir: "desc",
        contraptionsSortBy: "date",
        contraptionsSortDir: "desc"
    }
};

// Reset state helpers if needed
export function resetSearchState() {
    state.currentMods = [];
    state.nextCursor = "";
}
