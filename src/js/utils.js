// Utility functions for PP Mod Manager

// Tauri invoke wrapper
export function invoke(cmd, args) {
    return window.__TAURI__.core.invoke(cmd, args);
}

// Retry wrapper for transient HTTP errors
export async function invokeWithRetry(cmd, args, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await invoke(cmd, args);
        } catch (e) {
            const msg = String(e);
            const isTransient = msg.includes("HTTP request failed") ||
                msg.includes("error sending request") ||
                msg.includes("connection") ||
                msg.includes("timed out");
            if (isTransient && attempt < retries) {
                console.warn(`[Retry] ${cmd} attempt ${attempt + 1} failed, retrying...`);
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            throw e;
        }
    }
}

// Format bytes to human readable string
export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Securely escape HTML to prevent XSS
export function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Helper to escape single quotes for inline JS
export function escapeJs(str) {
    if (!str) return "";
    return str.replace(/'/g, "\\'");
}

// Configurable debounce
export function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Create toast notification
export function createToast(id, type, title, message, duration = 3000) {
    const container = document.getElementById("toast-container");
    const existing = document.getElementById(`toast-${id}`);
    if (existing) {
        // Update existing toast
        existing.className = `toast ${type}`;
        existing.querySelector(".toast-title").textContent = title;
        existing.querySelector(".toast-msg").textContent = message;

        // Reset progress animation
        const progress = existing.querySelector(".toast-progress");
        progress.style.animation = 'none';
        progress.offsetHeight; /* trigger reflow */
        progress.style.animation = null;

        // Clear old timeout if any
        if (existing._timeout) clearTimeout(existing._timeout);

        if (duration > 0) {
            existing._timeout = setTimeout(() => removeToast(existing), duration);
        }
        return;
    }

    const toast = document.createElement("div");
    toast.id = `toast-${id}`;
    toast.className = `toast ${type}`;
    // Simple icon mapping
    const icons = {
        success: "✓",
        error: "✕",
        info: "ℹ",
        downloading: "⬇"
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || ""}</div>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-msg">${escapeHtml(message)}</div>
        </div>
        <div class="toast-close" onclick="this.parentElement.remove()">×</div>
        <div class="toast-progress" style="transition: width ${duration}ms linear;"></div>
    `;

    container.appendChild(toast);

    if (duration > 0) {
        toast._timeout = setTimeout(() => removeToast(toast), duration);
    }
}

export function removeToast(toast) {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => {
        if (toast.parentElement) toast.remove();
    });
}

// Show/Hide Alert Helper
export function showAlert(containerId, message, type = "error") {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.className = `alert ${type}`;
    el.textContent = message;
    el.style.display = 'block'; // Ensure it's visible if hidden class is removed
}

export function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.className = "alert hidden";
}

// Add Log Entry
export function addLog(message, type = "info") {
    const container = document.getElementById("settings-logs");
    if (!container) return; // Might not be on settings page, or handle global logs differently

    // We might need a global log store if we want logs to persist when switching tabs
    // For now, we'll direct DOM manipulation to the settings-logs if it exists.

    const entry = document.createElement("div");
    entry.className = `logs-log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    container.prepend(entry);
}
