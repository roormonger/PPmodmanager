// Installed Mods & Contraptions Logic
import { invoke, formatBytes, escapeHtml, escapeJs, createToast, showAlert, hideAlert } from "../utils.js";
import { state } from "../state.js";
import { openModDetail } from "./browse.js"; // Reuse detail view

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

        if (loading) loading.classList.add("hidden");
        renderInstalledMods(enriched, 'mod');
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
        // (Reuse enrichInstalledMods logic)
        const enriched = await enrichInstalledMods(items);

        if (loading) loading.classList.add("hidden");
        renderInstalledMods(enriched, 'contraption');
    } catch (e) {
        if (loading) loading.classList.add("hidden");
        console.error("Contraptions load error:", e);
        showAlert("contraptions-alert", "Failed to load contraptions: " + e);
        // Note: added contraptions-alert to HTML in previous turn? 
        // Checked index.html in Step 4328, line 193: <div id="contraptions-alert" class="alert hidden"></div> exists.
    }
}

async function enrichInstalledMods(mods) {
    const results = [];
    for (const mod of mods) {
        let enriched = { ...mod };

        if (mod.ugc_id) {
            try {
                const detail = await invoke("get_mod_details_cmd", { publishedFileId: mod.ugc_id });
                enriched.steam_title = detail.title;
                enriched.steam_image = detail.preview_url;
                enriched.author = detail.creator_name || enriched.author;
            } catch {
                // Steam API failed, keep local data
            }
        }
        results.push(enriched);
    }
    return results;
}

// Generic renderer for both Mods and Contraptions
export function renderInstalledMods(items, type = "mod") {
    const containerId = type === "mod" ? "installed-list" : "contraptions-list";
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    items.forEach(mod => {
        const row = document.createElement("div");
        row.className = "installed-item";

        let thumbSrc = mod.thumbnail_data
            ? `data:image/jpeg;base64,${mod.thumbnail_data}`
            : "icon.png";

        if (mod.steam_image) thumbSrc = mod.steam_image;
        if (!thumbSrc || thumbSrc === "icon.png") {
            thumbSrc = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='%23222'%3E%3Crect width='64' height='64' /%3E%3C/svg%3E";
        }

        const title = mod.steam_title || mod.name || mod.folder_name;
        const author = mod.author || "Unknown";
        const size = formatBytes(mod.folder_size);
        const desc = mod.description || (mod.file_description ? mod.file_description.substring(0, 120) : "");

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
            <button class="installed-delete-btn" onclick="event.stopPropagation(); deleteInstalledItem('${escapeJs(mod.folder_name)}', '${type}')">Delete</button>
        `;

        row.style.cursor = "pointer";
        row.onclick = (e) => {
            // Prevent if clicking buttons
            if (e.target.tagName === "BUTTON") return;

            if (mod.ugc_id) {
                openModDetail(mod.ugc_id);
            } else {
                createToast(mod.name || mod.folder_name, "error", "Cannot Open Detail", "This item is not linked to Steam Workshop.", 4000);
            }
        };

        container.appendChild(row);
    });
}

export async function deleteInstalledItem(folderName, type = 'mod') {
    if (!confirm(`Are you sure you want to delete this ${type}?`)) return;

    try {
        await invoke("delete_installed_mod", { workshopId: folderName });
        if (type === 'mod') {
            loadInstalledMods();
        } else {
            loadContraptions();
        }
        createToast(folderName, "success", `${type} deleted`, `${folderName} removed.`, 3000);
    } catch (e) {
        alert("Failed to delete: " + e);
    }
}

export async function openModFolder() {
    try {
        await invoke("open_mods_folder");
    } catch (e) {
        console.error(e);
    }
}

export async function openContraptionsFolder() {
    try {
        await invoke("open_mods_folder");
    } catch (e) {
        console.error(e);
    }
}
