// Installed Mods & Contraptions Logic
import { invoke, formatBytes, escapeHtml, escapeJs, createToast, showAlert, hideAlert, addLog } from "../utils.js";
import { state } from "../state.js";
import { openModDetail } from "./browse.js"; // Reuse detail view
import { saveMetadataCache, saveUiState } from "./settings.js";

export async function loadInstalledMods() {
    const list = document.getElementById("installed-list");
    const loading = document.getElementById("installed-loading");
    const empty = document.getElementById("installed-empty");

    if (list) list.innerHTML = "";
    if (loading) loading.classList.remove("hidden");
    if (empty) empty.style.display = "none";
    hideAlert("installed-alert");

    // Force a small delay to make spinner visible and ensuring UI update
    await new Promise(r => setTimeout(r, 50));

    try {
        const mods = await invoke("list_installed_mods");

        if (!mods || mods.length === 0) {
            state.installedModsCache = [];
            if (loading) loading.classList.add("hidden");
            if (empty) empty.style.display = "block";
            return;
        }

        state.installedModsCache = mods;

        // Fetch details for each mod from Steam API to get titles/images
        const enriched = await enrichInstalledMods(mods);
        state.installedModsList = enriched; // Save for filtering

        if (loading) loading.classList.add("hidden");
        renderInstalledMods(enriched, 'mod');

        // Apply initial sort filter
        filterInstalledMods("");
    } catch (e) {
        if (loading) loading.classList.add("hidden");
        showAlert("installed-alert", String(e));
    }
}

export async function loadContraptions() {
    console.log("Loading contraptions...");
    const list = document.getElementById("contraptions-list");
    const loading = document.getElementById("contraptions-loading");
    const empty = document.getElementById("contraptions-empty");

    if (list) list.innerHTML = "";
    if (loading) loading.classList.remove("hidden");
    if (empty) empty.style.display = "none";
    hideAlert("contraptions-alert");

    // Force a small delay
    await new Promise(r => setTimeout(r, 50));

    try {
        const items = await invoke("list_installed_contraptions");
        console.log("Contraptions loaded:", items ? items.length : 0);

        if (!items || items.length === 0) {
            state.contraptionsCache = [];
            if (loading) loading.classList.add("hidden");
            if (empty) empty.style.display = "block";
            return;
        }

        state.contraptionsCache = items;

        // Fetch details for each mod from Steam API to get titles/images
        const enriched = await enrichInstalledMods(items);
        state.contraptionsList = enriched; // Save for filtering

        if (loading) loading.classList.add("hidden");
        renderInstalledMods(enriched, 'contraption');

        // Apply initial sort filter
        filterContraptions("");
    } catch (e) {
        if (loading) loading.classList.add("hidden");
        console.error("Contraptions load error:", e);
        showAlert("contraptions-alert", "Failed to load contraptions: " + e);
    }
}

async function enrichInstalledMods(mods) {
    const results = [];
    const missingIds = [];
    const cache = state.metadataCache || {};

    // First pass: Use cache
    for (const mod of mods) {
        let enriched = { ...mod };
        if (mod.ugc_id) {
            if (cache[mod.ugc_id]) {
                const cached = cache[mod.ugc_id];
                enriched.steam_title = cached.title;
                enriched.steam_image = cached.preview_url;
                enriched.author = cached.author;
                enriched.file_size = cached.size_bytes; // Use cached size if Steam API is skipped
            } else {
                missingIds.push(mod.ugc_id);
            }
        }
        results.push(enriched);
    }

    // Second pass: Fetch missing in batch
    if (missingIds.length > 0) {
        addLog(`[Installed] Fetching missing metadata for ${missingIds.length} items in batch...`, "info");
        try {
            const batchDetails = await invoke("get_multiple_mod_details_cmd", { publishedFileIds: missingIds });

            // Update results and cache
            for (const enriched of results) {
                if (enriched.ugc_id && batchDetails[enriched.ugc_id]) {
                    const detail = batchDetails[enriched.ugc_id];
                    enriched.steam_title = detail.title;
                    enriched.steam_image = detail.preview_url;
                    enriched.author = detail.creator_name || enriched.author;

                    // Update local cache
                    cache[enriched.ugc_id] = {
                        title: detail.title,
                        author: enriched.author,
                        preview_url: detail.preview_url,
                        size_bytes: parseInt(detail.file_size || "0")
                    };
                }
            }

            // Save cache back to disk
            state.metadataCache = cache;
            saveMetadataCache();
        } catch (e) {
            console.error("[Installed] Batch fetch failed:", e);
            addLog(`[Installed] Batch fetch failed: ${e}`, "error");
        }
    }

    return results;
}

function renderInstalledMods(mods, type) {
    const list = document.getElementById(type === 'mod' ? 'installed-list' : 'contraptions-list');
    if (!list) return;

    list.innerHTML = "";

    mods.forEach(mod => {
        const row = document.createElement("div");
        row.className = "installed-item";

        const title = mod.steam_title || mod.title || mod.name || mod.folder_name;
        const author = mod.author || "Unknown";
        // Use local folder_size first, then Steam file_size, then 0
        const size = formatBytes(mod.folder_size || mod.file_size || 0);
        // Default thumb
        let thumbSrc = mod.steam_image || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='%23222' %3E%3Crect width='64' height='64' /%3E%3C/svg%3E";

        const desc = mod.description || "";

        row.innerHTML = `
            <img class="installed-item-img" src="${thumbSrc}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 64 64\\' fill=\\'%23222\\' %3E%3Crect width=\\'64\\' height=\\'64\\' /%3E%3C/svg%3E'" />
            <div class="installed-item-info">
                <div class="installed-item-title">${escapeHtml(title)}</div>
                <div class="installed-item-meta" style="color: var(--text-secondary); margin-bottom: 2px;">
                    ${escapeHtml(author)}
                </div>
                <div class="installed-item-meta" style="opacity: 0.7;">
                    ${escapeHtml(mod.folder_name)} - ${size}
                </div>
                ${desc ? `<div class="installed-item-desc">${escapeHtml(desc)}</div>` : ""}
            </div>
            <button class="installed-delete-btn">Delete</button>
        `;

        row.style.cursor = "pointer";

        const deleteBtn = row.querySelector('.installed-delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteInstalledItem(mod.folder_name, type);
        });

        row.addEventListener('click', (e) => {
            // Robust check: if clicking a button (or inside one), exit
            if (e.target.closest('button')) return;

            if (mod.ugc_id) {
                openModDetail(mod.ugc_id);
            } else {
                createToast(mod.name || mod.folder_name, "error", "Cannot Open Detail", "This item is not linked to Steam Workshop.", 4000);
            }
        });
        list.appendChild(row);
    });
}

export async function deleteInstalledItem(folderName, type) {
    if (!await confirm("Are you sure you want to delete this?")) return;
    try {
        await invoke("delete_installed_mod", { folderName, type });
        createToast("Deleted item successfully", "success");
        if (type === 'mod') loadInstalledMods();
        else loadContraptions();
    } catch (e) {
        createToast("Delete Failed", "error", "Error", String(e));
    }
}

export function filterInstalledMods(query) {
    if (!state.installedModsList) return;
    const q = (query || "").toLowerCase();

    // Get Sort Settings
    const sortType = document.getElementById("installed-sort-type").value;
    const sortDir = state.settings.installedSortDir;

    // Update state
    state.settings.installedSortBy = sortType;
    saveUiState();

    let filtered = state.installedModsList.filter(mod => {
        return (mod.name && mod.name.toLowerCase().includes(q)) ||
            (mod.title && mod.title.toLowerCase().includes(q)) ||
            (mod.steam_title && mod.steam_title.toLowerCase().includes(q)) ||
            (mod.folder_name && mod.folder_name.toLowerCase().includes(q));
    });

    // Apply Sorting
    applyLocalSort(filtered, sortType, sortDir);

    renderInstalledMods(filtered, 'mod');
}

export function filterContraptions(query) {
    if (!state.contraptionsList) return;
    const q = (query || "").toLowerCase();

    // Get Sort Settings
    const sortType = document.getElementById("contraptions-sort-type").value;
    const sortDir = state.settings.contraptionsSortDir;

    // Update state
    state.settings.contraptionsSortBy = sortType;
    saveUiState();

    let filtered = state.contraptionsList.filter(item => {
        return (item.name && item.name.toLowerCase().includes(q)) ||
            (item.title && item.title.toLowerCase().includes(q)) ||
            (item.steam_title && item.steam_title.toLowerCase().includes(q)) ||
            (item.folder_name && item.folder_name.toLowerCase().includes(q));
    });

    // Apply Sorting
    applyLocalSort(filtered, sortType, sortDir);

    renderInstalledMods(filtered, 'contraption');
}

function applyLocalSort(list, type, dir) {
    list.sort((a, b) => {
        let valA, valB;
        if (type === "name") {
            valA = (a.steam_title || a.name || a.folder_name).toLowerCase();
            valB = (b.steam_title || b.name || b.folder_name).toLowerCase();
            return dir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else if (type === "size") {
            valA = a.folder_size || 0;
            valB = b.folder_size || 0;
        } else if (type === "date") {
            valA = a.created_at || 0;
            valB = b.created_at || 0;
        }

        if (dir === "asc") return valA - valB;
        return valB - valA;
    });
}

export function toggleLocalSortDir(type) {
    const isMod = type === 'mod';
    const key = isMod ? 'installedSortDir' : 'contraptionsSortDir';
    const current = state.settings[key];
    const next = current === 'asc' ? 'desc' : 'asc';
    state.settings[key] = next;
    saveUiState();

    // Update Button UI
    const btn = document.getElementById(isMod ? 'installed-sort-dir-btn' : 'contraptions-sort-dir-btn');
    if (btn) btn.textContent = next === 'asc' ? '▲' : '▼';

    // Refresh list
    if (isMod) {
        filterInstalledMods(document.getElementById("installed-search-input").value);
    } else {
        filterContraptions(document.getElementById("contraptions-search-input").value);
    }
}

export async function openModFolder(folderName) {
    try {
        await invoke("open_mod_folder", { folderName: folderName || "" });
    } catch (e) {
        createToast("Error opening folder", "error", "Error", String(e));
    }
}

export async function openContraptionsFolder(folderName) {
    try {
        await invoke("open_contraptions_folder", { folderName: folderName || "" });
    } catch (e) {
        createToast("Error opening folder", "error", "Error", String(e));
    }
}

export async function openRootFolder(type) {
    if (type === 'mod') {
        return openModFolder("");
    } else {
        return openContraptionsFolder("");
    }
}

// ── Real-time Updates ───────────────────────────
window.addEventListener('item-installed', (event) => {
    const { type } = event.detail;
    console.log(`[Installed] Notified of installation: ${type}`);

    // If the tab is active, refresh the list
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab) {
        if (type === 'mod' && activeTab.id === 'tab-installed') {
            loadInstalledMods();
        } else if (type === 'contraption' && activeTab.id === 'tab-contraptions') {
            loadContraptions();
        }
    }
});

// ── Persistence Helpers ─────────────────────────
export function syncInstalledUi() {
    console.log("[Installed] Syncing UI to state...");
    const selector = document.getElementById("installed-sort-type");
    if (selector) selector.value = state.settings.installedSortBy;

    const btn = document.getElementById("installed-sort-dir-btn");
    if (btn) btn.textContent = state.settings.installedSortDir === "asc" ? "▲" : "▼";
}

export function syncContraptionsUi() {
    console.log("[Contraptions] Syncing UI to state...");
    const selector = document.getElementById("contraptions-sort-type");
    if (selector) selector.value = state.settings.contraptionsSortBy;

    const btn = document.getElementById("contraptions-sort-dir-btn");
    if (btn) btn.textContent = state.settings.contraptionsSortDir === "asc" ? "▲" : "▼";
}
