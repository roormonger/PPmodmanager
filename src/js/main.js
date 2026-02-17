// Main Entry Point
import { state, resetSearchState } from "./state.js";
import { loadSettings, browseForFolder, saveSettings, checkUpdates, installUpdate, toggleLogs, copyLogs, clearLogs, toggleApiKeyVisibility } from "./tabs/settings.js";
import { searchMods, openModDetail, closeModDetail, installMod } from "./tabs/browse.js";
import { loadInstalledMods, loadContraptions, deleteInstalledItem, openModFolder, openContraptionsFolder, filterInstalledMods, filterContraptions, toggleLocalSortDir, openRootFolder } from "./tabs/installed.js";
import { searchCollections, openCollectionDetail, closeCollectionDetail, installCollectionItem } from "./tabs/collections.js";

// ── Tab Switching ───────────────────────────────
function switchTab(tabId) {
    console.log(`[Main] Switching to tab: ${tabId}`);
    // Update nav buttons
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        // Handle data-tab match
        btn.classList.toggle("active", btn.dataset.tab === tabId);
    });

    // Update tab content
    document.querySelectorAll(".tab-content").forEach((section) => {
        const isActive = section.id === `tab-${tabId}`;
        section.classList.toggle("active", isActive);
        if (isActive) section.style.display = "grid"; // or block depending on CSS? Original used multiple display
        else section.style.display = "none";
    });

    // Fix display for different types
    if (tabId === "browse" || tabId === "collections") {
        document.getElementById(`tab-${tabId}`).style.display = "grid";
    } else {
        document.getElementById(`tab-${tabId}`).style.display = "block";
    }

    // Handle specific tab logic
    if (tabId === "browse") {
        if (state.currentMods.length === 0) searchMods();
    }
    else if (tabId === "installed") {
        loadInstalledMods();
    }
    else if (tabId === "contraptions") {
        loadContraptions();
    }
    else if (tabId === "collections") {
        if (state.currentCollections.length === 0) searchCollections();
    }
    else if (tabId === "settings") {
        loadSettings();
    }
}


// ── Initialization ──────────────────────────────
async function init() {
    // Expose functions to window for HTML onclick handlers
    exposeToWindow();

    // Initial Load
    await loadSettings(); // Populates state.settings
    // Find active tab from HTML if any, default to browse
    switchTab("browse");

    // Add infinite scroll
    const content = document.getElementById("content");
    content.addEventListener("scroll", handleScroll);
}

function handleScroll() {
    const el = document.getElementById("content");
    // Simple check
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) {
        const activeTab = document.querySelector(".tab-content.active");
        if (!activeTab) return;

        if (activeTab.id === "tab-browse" && state.nextCursor) {
            searchMods(false);
        }
        else if (activeTab.id === "tab-collections" && state.nextCursor) {
            searchCollections(false);
        }
    }
}

// ── Expose to Window ────────────────────────────
function exposeToWindow() {
    window.switchTab = switchTab;

    // Browse
    window.searchMods = (reset) => searchMods(reset); // Wrap to handle HTML onclick without args
    window.openModDetail = openModDetail;
    window.closeModDetail = closeModDetail;
    window.installMod = installMod;

    // Installed
    window.deleteInstalledItem = deleteInstalledItem;
    window.openModFolder = openModFolder;
    window.openContraptionsFolder = openContraptionsFolder;
    window.loadInstalledMods = loadInstalledMods;
    window.loadContraptions = loadContraptions;
    window.filterInstalledMods = filterInstalledMods;
    window.filterContraptions = filterContraptions;
    window.toggleLocalSortDir = toggleLocalSortDir;
    window.openRootFolder = openRootFolder;

    // Collections
    window.searchCollections = (reset) => searchCollections(reset);
    window.closeModDetail = closeModDetail;
    window.openCollectionDetail = openCollectionDetail;
    window.closeCollectionDetail = closeCollectionDetail;
    // window.installCollectionItem = installCollectionItem; // If needed directly

    // Settings
    window.saveSettings = saveSettings;
    window.browseForFolder = browseForFolder;
    window.checkUpdates = checkUpdates;
    window.installUpdate = installUpdate;
    window.toggleLogs = toggleLogs;
    window.copyLogs = copyLogs;
    window.clearLogs = clearLogs;
    window.toggleApiKeyVisibility = toggleApiKeyVisibility;
}

// Start
document.addEventListener("DOMContentLoaded", init);
