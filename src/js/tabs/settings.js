// Settings Tab Logic
import { invoke, createToast, showAlert, hideAlert, addLog } from "../utils.js";
import { state } from "../state.js";

// Load settings from backend and populate UI
export async function loadSettings() {
    try {
        const settings = await invoke("get_settings_cmd");
        if (settings) {
            state.settings = { ...state.settings, ...settings };

            // Populate Inputs
            const apiKeyInput = document.getElementById("api-key");
            if (apiKeyInput) apiKeyInput.value = settings.api_key || "";

            const ppDirInput = document.getElementById("pp-dir");
            if (ppDirInput) ppDirInput.value = settings.game_path || "";

            // Check updates automatically if first load? (Optional)
            checkUpdates();
        }
        renderLogs();
    } catch (e) {
        showAlert("settings-alert", "Failed to load settings: " + e);
    }
}

export async function saveSettings() {
    const apiKey = document.getElementById("api-key").value.trim();
    const gamePath = document.getElementById("pp-dir").value.trim();

    try {
        await invoke("save_settings_cmd", {
            apiKey,
            gamePath
        });

        // Update local state
        state.settings.apiKey = apiKey;
        state.settings.gamePath = gamePath;

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
            if (status) status.textContent = "Up to date (v0.5.5)";
            if (btn) {
                btn.textContent = "Check for Updates";
                btn.disabled = false;
            }
            createToast("no-update", "info", "Up to date", "You are on the latest version.", 2000);
        }
    } catch (e) {
        if (status) status.textContent = "Check failed";
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
