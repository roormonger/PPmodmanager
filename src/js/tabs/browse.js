// Browse Tab Logic
import { invokeWithRetry, formatBytes, escapeHtml, escapeJs, showAlert, hideAlert, addLog } from "../utils.js";
import { state } from "../state.js";
import { openModDetail } from "./browse.js"; // Recursive import for onclick, handled by modules fine usually

// Re-export openModDetail so it can be used by other tabs if needed (e.g. from installed list)
// actually openModDetail is defined below.

// ── Search & Filter Logic ───────────────────────
export async function searchMods(reset = true) {
    if (reset) {
        state.nextCursor = "";
        state.currentMods = [];
        window.scrollTo(0, 0);
    }

    const query = document.getElementById("search-input").value.trim();
    const sortType = parseInt(document.getElementById("sort-type").value);
    const sortDays = parseInt(document.getElementById("sort-days").value);
    const cursor = state.nextCursor;

    // Filters
    const selectedTags = Array.from(document.querySelectorAll("#filter-tags input:checked"))
        .map(cb => cb.value);

    // Initial loading UI
    const loadingEl = document.getElementById("loading");
    if (reset) {
        document.getElementById("mods-grid").innerHTML = "";
        loadingEl.classList.remove("hidden");
    }

    // Logic for "All" tags optimization
    const ALL_TAGS = [
        "Contraption", "Structure", "Vehicle", "Human",
        "Clothing", "Weapon", "Armor", "Explosive",
        "Melee", "Firearm", "Mod" // Added Mod tag
    ];
    let tagsToSend = selectedTags;
    if (selectedTags.length === ALL_TAGS.length) tagsToSend = [];

    hideAlert("mods-alert");
    try {
        const data = await invokeWithRetry("search_mods_cmd", {
            query,
            cursor,
            sortType,
            days: sortDays,
            requiredTags: tagsToSend
        });

        addLog(`[Search] Got ${data?.publishedfiledetails?.length || 0} items. Next cursor: ${data?.next_cursor ? "Yes" : "No"}`, "info");

        if (data && data.publishedfiledetails) {
            if (data.publishedfiledetails.length === 0) {
                state.nextCursor = "";
                renderMods();
                return;
            }
            if (!cursor) {
                state.currentMods = data.publishedfiledetails;
            } else {
                state.currentMods = [...state.currentMods, ...data.publishedfiledetails];
            }
            state.nextCursor = data.next_cursor || "";
            addLog(`[Search] Total: ${state.currentMods.length}. Next cursor: ${state.nextCursor.substring(0, 10)}...`, "info");
            renderMods();
        }
    } catch (e) {
        const msg = String(e);
        if (msg.includes("API Key")) {
            showAlert(
                "mods-alert",
                "Steam API Key not configured. Go to Settings to add one.",
                "error"
            );
        } else {
            showAlert("mods-alert", "Failed to load mods: " + msg, "error");
        }
    } finally {
        loadingEl.classList.add("hidden");
    }
}

export function renderMods() {
    const grid = document.getElementById("mods-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // Filter out installed mods from browse results
    const browseMods = state.currentMods.filter(mod =>
        !state.installedModsCache.some(m => m.ugc_id === mod.publishedfileid)
    );

    if (browseMods.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">No mods found matching criteria.</div>`;
        return;
    }

    browseMods.forEach((mod) => {
        const card = document.createElement("div");
        card.className = "mod-card";
        const date = mod.time_updated
            ? new Date(mod.time_updated * 1000).toLocaleDateString()
            : "";

        // Use SVG fallback if preview_url is empty
        const imgSrc = mod.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300' fill='%23222'%3E%3Crect width='300' height='300' /%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23666' font-family='sans-serif' font-size='24'%3ENo Image%3C/text%3E%3C/svg%3E";

        // Star rating from vote_data.score (0-1 → 5 stars)
        const score = mod.vote_data ? mod.vote_data.score : 0;
        const starCount = Math.round(score * 5);
        let starsHtml = "";
        for (let i = 1; i <= 5; i++) {
            starsHtml += `<span class="star ${i <= starCount ? 'filled' : ''}">★</span>`;
        }

        const author = mod.creator_name || "";

        card.innerHTML = `
            <img class="mod-card-img" src="${imgSrc}" alt="${escapeHtml(mod.title)}" loading="lazy" onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 300 300\\' fill=\\'%23222\\' %3E%3Crect width=\\'300\\' height=\\'300\\' /%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23666\\' font-family=\\'sans-serif\\' font-size=\\'24\\' %3ENo Image%3C/text%3E%3C/svg%3E'" />
            <div class="mod-card-body">
                <div class="mod-card-stars">${starsHtml}</div>
                <div class="mod-card-title">${escapeHtml(mod.title)}</div>
                ${author ? `<div class="mod-card-author">by ${escapeHtml(author)}</div>` : ""}
            </div>
            <div class="mod-card-footer">
                <button class="install-btn" onclick="event.stopPropagation(); installMod('${mod.publishedfileid}', '${escapeJs(mod.title)}', this)">Install</button>
            </div>
        `;
        card.style.cursor = "pointer";
        card.onclick = () => openModDetail(mod.publishedfileid);
        grid.appendChild(card);
    });
}

// ── Mod Detail View ─────────────────────────────
// Track previous tab to return to
let previousTab = "browse";

export async function openModDetail(publishedFileId) {
    // Save current tab before switching (primitive way)
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && activeTab.id !== "tab-detail") {
        previousTab = activeTab.id.replace("tab-", "");
    }

    // Switch UI (We might need to import switchTab or handle it manually here)
    // For now, let's just do class manipulation as in original code
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById("tab-detail").classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    // Show loading
    document.getElementById("detail-loading").style.display = "flex";
    document.getElementById("detail-content").style.display = "none";
    document.getElementById("content").scrollTop = 0;

    try {
        const mod = await invokeWithRetry("get_mod_details_cmd", { publishedFileId: publishedFileId });
        renderModDetail(mod);
    } catch (e) {
        document.getElementById("detail-loading").style.display = "none";
        document.getElementById("detail-content").style.display = "grid";
        document.getElementById("detail-title").textContent = "Error loading mod";
        document.getElementById("detail-description").textContent = String(e);
    }
}

function renderModDetail(mod) {
    document.getElementById("detail-loading").style.display = "none";
    document.getElementById("detail-content").style.display = "grid";

    // Header
    const imgSrc = mod.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300' fill='%23222'%3E%3Crect width='300' height='300' /%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23666' font-family='sans-serif' font-size='24'%3ENo Image%3C/text%3E%3C/svg%3E";
    document.getElementById("detail-icon").src = imgSrc;
    document.getElementById("detail-title").textContent = mod.title;

    // Meta
    const metaEl = document.getElementById("detail-meta");
    const date = mod.time_updated ? new Date(mod.time_updated * 1000).toLocaleDateString() : "Unknown";
    const size = formatBytes(mod.file_size || 0);
    const author = mod.creator_name || "Unknown";

    let html = `<span>By ${escapeHtml(author)}</span> • <span>${date}</span> • <span>${size}</span>`;

    // Rating
    const score = mod.vote_data ? mod.vote_data.score : 0;
    const starCount = Math.round(score * 5).toFixed(1);
    html += ` • <span style="color:#f59e0b">★ ${starCount}</span>`;

    metaEl.innerHTML = html;

    // Description
    document.getElementById("detail-description").innerHTML = mod.file_description
        ? escapeHtml(mod.file_description).replace(/\n/g, "<br>")
        : "No description provided.";

    // Install Button on Detail Page
    const btn = document.getElementById("detail-install-btn");

    // Check if installed
    const isInstalled = state.installedModsCache.some(m => m.ugc_id === mod.publishedfileid);

    if (isInstalled) {
        btn.textContent = "Installed";
        btn.classList.add("installed");
        btn.onclick = null;
    } else {
        btn.textContent = "Install Mod";
        btn.classList.remove("installed");
        btn.onclick = () => installMod(mod.publishedfileid, mod.title, btn);
    }
}

export function closeModDetail() {
    // Switch back to previous tab
    // We need to trigger the tab switch logic in main.js
    // Since we can't import main.js (circular), we might rely on window.switchTab if exposed
    if (window.switchTab) {
        window.switchTab(previousTab);
    }
}

// Installation Logic
export async function installMod(publishedFileId, title, btnElement) {
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.textContent = "Installing...";
    }

    createToast(`install-${publishedFileId}`, "downloading", "Downloading...", `Installing ${title}`, 0);

    try {
        await invokeWithRetry("install_mod_cmd", { publishedFileId: publishedFileId });

        // Success
        const toast = document.getElementById(`toast-install-${publishedFileId}`);
        if (toast) {
            toast.className = "toast success";
            toast.querySelector(".toast-title").textContent = "Installed";
            toast.querySelector(".toast-msg").textContent = `${title} is ready.`;
            toast.querySelector(".toast-icon").textContent = "✓";
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 3000);
        } else {
            createToast(publishedFileId, "success", "Installed", `${title} is ready.`);
        }

        if (btnElement) {
            btnElement.textContent = "Installed";
            btnElement.classList.add("installed");
            btnElement.onclick = null;
        }

        // Refresh installed list silently
        // We can dispatch an event or rely on state refresh next time tab opens
        // For immediate update if we are on browse, we might want to update cache
        // But loadInstalledMods() will handle it.

    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.textContent = "Install";
        }
        const toast = document.getElementById(`toast-install-${publishedFileId}`);
        if (toast) {
            toast.className = "toast error";
            toast.querySelector(".toast-title").textContent = "Installation Failed";
            toast.querySelector(".toast-msg").textContent = String(e);
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 5000);
        } else {
            createToast("error", "error", "Installation Failed", String(e));
        }
    }
}
