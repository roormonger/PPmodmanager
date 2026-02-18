// Settings Tab Logic
import { invoke, invokeWithRetry, showAlert, hideAlert, addLog } from "../utils.js";
import { state } from "../state.js";

// Load settings from backend and populate UI
export async function loadSettings() {
    try {
        // Fetch Version
        const version = await invoke("get_app_version");
        state.settings.version = version;

        const sidebarVersion = document.getElementById("app-version");
        if (sidebarVersion) sidebarVersion.textContent = `v${version}`;

        const settingsVersion = document.getElementById("update-status");
        if (settingsVersion) settingsVersion.textContent = `v${version}`;

        const settings = await invoke("get_config");
        if (settings) {
            // Update local state with mapped keys
            state.settings.apiKey = settings.steam_api_key || "";
            state.settings.gamePath = settings.people_playground_dir || "";
            state.settings.steamcmdPath = settings.steamcmd_dir || "";

            // Persistent UI
            state.settings.sortType = settings.browse_sort_type || 3;
            state.settings.sortDays = settings.browse_sort_days || 7;
            state.settings.browseTags = settings.browse_tags || [];
            state.settings.collSortType = settings.collections_sort_type || 3;
            state.settings.collSortDays = settings.collections_sort_days || 7;
            state.settings.collSortDir = settings.collections_sort_dir || "desc";
            state.settings.installedSortBy = settings.installed_sort_by || "date";
            state.settings.installedSortDir = settings.installed_sort_dir || "desc";
            state.settings.contraptionsSortBy = settings.contraptions_sort_by || "date";
            state.settings.contraptionsSortDir = settings.contraptions_sort_dir || "desc";

            // Load Metadata Cache
            try {
                state.metadataCache = await invoke("load_metadata_cache_cmd");
                addLog(`[Settings] Loaded ${Object.keys(state.metadataCache).length} cached mod metadata entries`, "info");
            } catch (e) {
                console.error("[Settings] Failed to load metadata cache:", e);
            }

            // Populate Inputs
            const apiKeyInput = document.getElementById("api-key");
            if (apiKeyInput) apiKeyInput.value = state.settings.apiKey;

            const ppDirInput = document.getElementById("pp-dir");
            if (ppDirInput) ppDirInput.value = state.settings.gamePath;

            const steamcmdDirInput = document.getElementById("steamcmd-dir");
            if (steamcmdDirInput) steamcmdDirInput.value = state.settings.steamcmdPath;

            // Check updates automatically if first load? (Optional)
            checkUpdates();
        }
        renderLogs();
    } catch (e) {
        showAlert("settings-alert", "Failed to load settings: " + e);
    }
}

export async function saveUiState() {
    try {
        await invoke("save_ui_state_cmd", {
            browseSortType: parseInt(state.settings.sortType),
            browseSortDays: parseInt(state.settings.sortDays),
            browseTags: state.settings.browseTags || [],
            collectionsSortType: parseInt(state.settings.collSortType),
            collectionsSortDays: parseInt(state.settings.collSortDays),
            collectionsSortDir: state.settings.collSortDir,
            installedSortBy: state.settings.installedSortBy,
            installedSortDir: state.settings.installedSortDir,
            contraptionsSortBy: state.settings.contraptionsSortBy,
            contraptionsSortDir: state.settings.contraptionsSortDir
        });
    } catch (e) {
        console.error("[Settings] Failed to save dynamic UI state:", e);
    }
}

export async function saveMetadataCache() {
    try {
        await invoke("save_metadata_cache_cmd", { cache: state.metadataCache });
    } catch (e) {
        console.error("[Settings] Failed to save metadata cache:", e);
    }
}

export async function saveSettings() {
    const apiKey = document.getElementById("api-key").value.trim();
    const gamePath = document.getElementById("pp-dir").value.trim();
    const steamcmdPath = document.getElementById("steamcmd-dir").value.trim();

    try {
        await invoke("save_config_cmd", {
            steamApiKey: apiKey,
            peoplePlaygroundDir: gamePath,
            steamcmdDir: steamcmdPath
        });

        // Update local state
        state.settings.apiKey = apiKey;
        state.settings.gamePath = gamePath;
        state.settings.steamcmdPath = steamcmdPath;

        createToast("settings-saved", "success", "Settings Saved", "Configuration updated successfully.");
        hideAlert("settings-alert");
    } catch (e) {
        showAlert("settings-alert", "Failed to save settings: " + e);
    }
}

export async function browseForFolder() {
    try {
        const selected = await window.__TAURI__.plugin.dialog.open({
            directory: true,
            multiple: false,
            title: "Select Mods Folder" // e.g. .../People Playground/Mods
        });

        if (selected) {
            document.getElementById("pp-dir").value = selected;
        }
    } catch (e) {
        console.error(e);
    }
}

export async function browseForSteamCMD() {
    try {
        const selected = await window.__TAURI__.plugin.dialog.open({
            directory: true,
            multiple: false,
            title: "Select SteamCMD Folder"
        });

        if (selected) {
            document.getElementById("steamcmd-dir").value = selected;
        }
    } catch (e) {
        console.error(e);
    }
}

export function toggleApiKeyVisibility() {
    const input = document.getElementById("api-key");
    const btn = document.querySelector(".icon-toggle-btn");
    const isPassword = input.type === "password";

    input.type = isPassword ? "text" : "password";

    // Update SVG icon (Add/remove slash)
    if (isPassword) {
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="eye-icon">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
        `;
    } else {
        btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="eye-icon">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        `;
    }
}

// ── Logs Logic ──────────────────────────────────
// Logs are stored in DOM for now, but we can manage them better here if needed.
// Since utils.js adds logs directly to the DOM, this file just handles the toggling/clearing.

export function renderLogs() {
    // Current implementations writes directly to DOM via addLog in utils.
    // If we wanted to re-render from a state array, we would do it here.
}

export function toggleLogs() {
    const content = document.getElementById("logs-content");
    const section = document.getElementById("logs-section");
    if (content) {
        content.classList.toggle("expanded");
        section.classList.toggle("expanded");
    }
}

export function copyLogs() {
    const logs = document.getElementById("settings-logs");
    if (logs) {
        navigator.clipboard.writeText(logs.innerText);
        createToast("logs-copy", "success", "Copied", "Logs copied to clipboard.");
    }
}

export function clearLogs() {
    const logs = document.getElementById("settings-logs");
    if (logs) logs.innerHTML = "";
}

// ── Auto-Updater ────────────────────────────────
export async function checkUpdates() {
    const btn = document.getElementById("update-btn");
    const status = document.getElementById("update-status");

    if (btn) btn.disabled = true;
    if (status) status.textContent = "Checking...";

    try {
        const update = await invoke("check_for_updates");
        if (update) {
            if (status) status.textContent = `Avail: v${update.version}`;
            if (btn) {
                btn.textContent = "Update Now";
                btn.disabled = false;
                btn.onclick = () => installUpdate(btn);
            }
            createToast("update-avail", "success", "Update Available", `Version ${update.version} is ready.`);
        } else {
            if (status) status.textContent = `Up to date (v${state.settings.version || "0.6.0"})`;
            if (btn) {
                btn.textContent = "Check for Updates";
                btn.disabled = false;
            }
            createToast("no-update", "info", "Up to date", "You are on the latest version.", 2000);
        }
    } catch (e) {
        if (status) status.textContent = `v${state.settings.version || "0.6.0"} (Check failed)`;
        if (btn) {
            btn.textContent = "Check for Updates";
            btn.disabled = false;
        }
        createToast("update-err", "error", "Update Check Failed", String(e), 4000);
    }
}

export async function installUpdate(btn) {
    if (!confirm("Update will download and restart the app. Continue?")) return;

    btn.disabled = true;
    btn.textContent = "Downloading...";

    try {
        await invoke("install_update");
    } catch (e) {
        btn.textContent = "Update Now";
        btn.disabled = false;
        createToast("install-err", "error", "Update Failed", String(e), 5000);
    }
}
