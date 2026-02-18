// Browse Tab Logic
import { invoke, invokeWithRetry, formatBytes, escapeHtml, escapeJs, showAlert, hideAlert, addLog, openUrl } from "../utils.js";
import { state } from "../state.js";
import { saveUiState } from "./settings.js";

const ALL_TAGS = [
    "Contraption", "Structure", "Vehicle", "Human",
    "Clothing", "Weapon", "Armor", "Explosive",
    "Melee", "Firearm", "Mod"
];


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
    const sortTypeSelector = document.getElementById("sort-type");
    const sortDaysSelector = document.getElementById("sort-days");

    let sortType = parseInt(sortTypeSelector.value);
    const sortDays = parseInt(sortDaysSelector.value);

    // Update state
    state.settings.sortType = sortType;
    state.settings.sortDays = sortDays;
    saveUiState();

    // Apply Sort Direction Mapping for Steam API (only 0/Top Rated supports Ascending via 10)
    if (state.settings.browseSortDir === "asc" && sortType === 0) {
        sortType = 10; // RankedByTotalVotesAsc
    }

    const cursor = state.nextCursor;

    const selectedTags = state.settings.browseTags || [];

    // Initial loading UI
    const loadingEl = document.getElementById("mods-loading");
    if (reset) {
        document.getElementById("mods-grid").innerHTML = "";
        loadingEl.classList.remove("hidden");
    }

    // Logic for "All" tags optimization
    let tagsToSend = state.settings.browseTags || [];
    if (tagsToSend.length === ALL_TAGS.length) tagsToSend = [];

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
        card.dataset.id = mod.publishedfileid;
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
        const title = mod.title || "Untitled";
        const author = mod.creator_name || "Unknown";
        const size = formatBytes(mod.file_size);

        // Chip Logic - Fix plural 'Contraptions' check
        const isContraption = mod.tags && mod.tags.some(t => t.tag === 'Contraption' || t.tag === 'Contraptions');
        const typeLabel = isContraption ? 'Contraption' : 'Mod';

        card.innerHTML = `
            <img class="mod-card-img" src="${imgSrc}" alt="${escapeHtml(mod.title)}" loading="lazy" onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 300 300\\' fill=\\'%23222\\' %3E%3Crect width=\\'300\\' height=\\'300\\' /%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23666\\' font-family=\\'sans-serif\\' font-size=\\'24\\' %3ENo Image%3C/text%3E%3C/svg%3E'" />
            <div class="mod-card-body">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div class="mod-card-stars" style="margin-bottom: 0;">${starsHtml}</div>
                    <span style="font-size: 11px; color: var(--text-muted);">${typeLabel}</span>
                </div>
                <div class="mod-card-title">${escapeHtml(mod.title)}</div>
                ${author ? `<div class="mod-card-author">by ${escapeHtml(author)}</div>` : ""}
            </div>
            <div class="mod-card-footer">
                <button class="install-btn">Install</button>
            </div>
        `;

        card.style.cursor = "pointer";

        // Separate logic for install button to ensure it stops propagation reliably
        const installBtn = card.querySelector('.install-btn');
        installBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            installMod(mod.publishedfileid, mod.title, installBtn);
        });

        // Card click logic with "Double Lock"
        card.addEventListener('click', (e) => {
            // If the user clicked the install button (or anything inside it), ignore the card click
            if (e.target.closest('.install-btn')) return;

            openModDetail(mod.publishedfileid);
        });

        grid.appendChild(card);
    });
}

// ── Mod Detail View ─────────────────────────────
// Track previous tab to return to
let previousTab = "browse";

export async function openModDetail(publishedFileId) {
    console.log(`[Browse] openModDetail called for ${publishedFileId}`);
    // Save current tab before switching (primitive way)
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && activeTab.id !== "tab-detail") {
        previousTab = activeTab.id.replace("tab-", "");
    }

    // Switch UI (We might need to import switchTab or handle it manually here)
    // For now, let's just do class manipulation as in original code
    // Switch UI
    document.querySelectorAll(".tab-content").forEach(s => {
        s.classList.remove("active");
        s.style.display = "none";
    });
    const detailTab = document.getElementById("tab-detail");
    detailTab.classList.add("active");
    detailTab.style.display = "block";

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
    // const metaEl = document.getElementById("detail-meta"); // Doesn't exist in index.html, we have individual fields
    const date = mod.time_updated ? new Date(mod.time_updated * 1000).toLocaleDateString() : "Unknown";
    const size = formatBytes(mod.file_size || 0);
    const author = mod.creator_name || "Unknown";

    // Fill individual fields
    const setIfExists = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    const isContraption = mod.tags && mod.tags.some(t => t.tag === 'Contraption' || t.tag === 'Contraptions');

    setIfExists("detail-author", author);
    setIfExists("detail-type", isContraption ? "Contraption" : "Mod");
    setIfExists("detail-filesize", size);
    setIfExists("detail-created", mod.time_created ? new Date(mod.time_created * 1000).toLocaleDateString() : "Unknown");
    setIfExists("detail-updated", date);
    setIfExists("detail-subs", mod.subscriptions || "N/A"); // API might not return this standardly?
    setIfExists("detail-favs", mod.favorited || "N/A");
    setIfExists("detail-views", mod.views || "N/A");

    // Rating (Stars)
    const score = mod.vote_data ? mod.vote_data.score : 0;
    const starCount = Math.round(score * 5);
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
        starsHtml += `<span class="star ${i <= starCount ? 'filled' : ''}">★</span>`;
    }
    // Add text rating
    starsHtml += ` <span style="color:var(--text-muted); font-size: 0.9em; margin-left: 5px;">(${starCount}/5)</span>`;

    const starEl = document.getElementById("detail-stars");
    if (starEl) starEl.innerHTML = starsHtml;

    // Gallery Logic
    const mainMedia = document.getElementById("detail-media-main");
    const thumbContainer = document.getElementById("detail-thumbnails");

    // Clear previous
    if (mainMedia) mainMedia.innerHTML = "";
    if (thumbContainer) thumbContainer.innerHTML = "";

    // Helper to set main media
    const setMainMedia = (url, isVideo) => {
        if (!mainMedia) return;
        mainMedia.innerHTML = "";
        if (isVideo) {
            // Extract video ID from youtube url if possible
            // Format usually: https://www.youtube.com/watch?v=VIDEO_ID
            let videoId = "";
            try {
                const u = new URL(url);
                videoId = u.searchParams.get("v");
                if (!videoId && url.includes("youtu.be/")) videoId = url.split("youtu.be/")[1];
                if (!videoId && url.includes("/embed/")) videoId = url.split("/embed/")[1];

                // Fallback for direct youtube link in additional_previews
                // sometimes it's just the ID? API usually gives full url
            } catch (e) { }

            if (videoId) {
                mainMedia.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>`;
            } else {
                // Try direct embed if url seems embeddable
                mainMedia.innerHTML = `<iframe width="100%" height="100%" src="${url}" frameborder="0" allowfullscreen></iframe>`;
            }
        } else {
            mainMedia.innerHTML = `<img src="${url}" alt="Preview" />`;
        }
    };

    // 2. Build Thumbnails list
    const mediaItems = [];

    // Add additional previews
    // API returns 'previews' (or sometimes 'additional_previews'?)
    const previews = mod.previews || mod.additional_previews;

    if (previews && Array.isArray(previews)) {
        previews.forEach(p => {
            // p has .url, .youtubevideo id?, .previewid
            // Steam API: youtubevideoid is set if video. url is set if image.

            if (p.youtubevideoid) {
                const videoUrl = `https://www.youtube.com/watch?v=${p.youtubevideoid}`;
                const thumbUrl = `https://img.youtube.com/vi/${p.youtubevideoid}/mqdefault.jpg`;
                mediaItems.push({ url: videoUrl, thumb: thumbUrl, isVideo: true });
            } else if (p.url) {
                mediaItems.push({ url: p.url, isVideo: false });
            }
        });
    }

    // 1. Set Initial Main Preview
    if (mediaItems.length > 0) {
        setMainMedia(mediaItems[0].url, mediaItems[0].isVideo);
    } else {
        setMainMedia(imgSrc, false); // Fallback to thumbnail if no gallery
    }

    // Render Thumbnails
    if (thumbContainer) {
        mediaItems.forEach((item, index) => {
            const thumb = document.createElement("div");
            thumb.className = "detail-thumbnail";
            if (index === 0) thumb.classList.add("active");

            const tImg = document.createElement("img");
            tImg.src = item.thumb || item.url;
            tImg.loading = "lazy";

            // Play icon overlay for video
            if (item.isVideo) {
                const playIcon = document.createElement("div");
                playIcon.className = "thumb-play-icon";
                playIcon.textContent = "▶";
                thumb.appendChild(playIcon);
            }

            thumb.appendChild(tImg);

            thumb.onclick = () => {
                // Remove active from all
                document.querySelectorAll(".detail-thumbnail").forEach(t => t.classList.remove("active"));
                thumb.classList.add("active");
                setMainMedia(item.url, item.isVideo);
            };

            thumbContainer.appendChild(thumb);
        });
    }



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

    // Workshop Link
    const workshopLink = document.getElementById("detail-workshop-link");
    if (workshopLink) {
        if (!mod.publishedfileid) {
            workshopLink.style.display = "none";
        } else {
            const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`;
            console.log(`[Browse] Setting Workshop Link for ${mod.publishedfileid}: ${url}`);
            workshopLink.style.display = "inline-flex";
            workshopLink.href = "javascript:void(0)";
            workshopLink.onclick = (e) => {
                e.preventDefault();
                openUrl(url);
            };
        }
    }
}

export function closeModDetail() {
    // Stop video playback by clearing the container
    const mainMedia = document.getElementById("detail-media-main");
    if (mainMedia) mainMedia.innerHTML = "";

    // Clear thumbnails as well
    const thumbContainer = document.getElementById("detail-thumbnails");
    if (thumbContainer) thumbContainer.innerHTML = "";

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
        btnElement.textContent = "Queued";
    }

    try {
        await invokeWithRetry("install_mod", {
            workshopId: publishedFileId,
            title: title
        });

        // Success enqueueing (not necessarily finished downloading)
        addLog(`[Queue] Enqueued mod: ${title} (${publishedFileId})`, "info");

        // The UI in the sidebar will take over from here.
        // We don't need to wait or do anything else on this button 
        // until the next refresh of the installed list.

    } catch (e) {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.textContent = "Install";
        }
        createToast("error", "error", "Queue Error", String(e));
    }
}
// ── UI Init & Helpers ───────────────────────────
export function initBrowseTab() {
    console.log("[Browse] Initializing tab UI...");

    // 1. Sync Inputs to State
    const sortToggle = document.getElementById("sort-type");
    if (sortToggle) sortToggle.value = state.settings.sortType;

    const daysToggle = document.getElementById("sort-days");
    if (daysToggle) daysToggle.value = state.settings.sortDays;

    const dirBtn = document.getElementById("sort-dir-btn");
    updateSortDirBtn();

    // 2. Render Tags
    renderTagsDropdown();
}

export function renderTagsDropdown() {
    const list = document.getElementById("tags-list");
    if (!list) return;

    list.innerHTML = "";

    const selected = state.settings.browseTags || [];

    ALL_TAGS.forEach(tag => {
        const isChecked = selected.includes(tag);
        const div = document.createElement("div");
        div.className = `custom-option ${isChecked ? 'selected' : ''}`;
        div.onclick = (e) => {
            e.stopPropagation();
            toggleTag(tag);
        };
        div.innerHTML = `
            <input type="checkbox" ${isChecked ? "checked" : ""} readonly>
            <span>${tag}</span>
        `;
        list.appendChild(div);
    });

    updateTagLabel();
}

export function toggleTagsDropdown() {
    const container = document.getElementById("tags-dropdown");
    if (container) {
        container.querySelector(".custom-select-options").classList.toggle("open");
    }
}

// Global click to close dropdown (handled in main.js ideally, but browse.js works too)
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('tags-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.querySelector(".custom-select-options").classList.remove("open");
    }
});

function toggleTag(tag) {
    let current = state.settings.browseTags || [];
    if (current.includes(tag)) {
        current = current.filter(t => t !== tag);
    } else {
        current.push(tag);
    }
    state.settings.browseTags = current;

    renderTagsDropdown();
    saveUiState();
    searchMods();
}

export function toggleAllTags() {
    const current = state.settings.browseTags || [];
    if (current.length === ALL_TAGS.length) {
        state.settings.browseTags = [];
    } else {
        state.settings.browseTags = [...ALL_TAGS];
    }

    renderTagsDropdown();
    saveUiState();
    searchMods();
}

function updateTagLabel() {
    const label = document.getElementById("tags-label");
    if (!label) return;

    const selected = state.settings.browseTags || [];
    if (selected.length === ALL_TAGS.length) {
        label.textContent = "All Tags";
    } else if (selected.length === 0) {
        label.textContent = "No Tags";
    } else {
        label.textContent = `${selected.length} Selected`;
    }
}

export function toggleSortDir() {
    const current = state.settings.browseSortDir;
    state.settings.browseSortDir = current === "desc" ? "asc" : "desc";

    updateSortDirBtn();
    saveUiState();
    searchMods();
}

function updateSortDirBtn() {
    const btn = document.getElementById("sort-dir-btn");
    if (!btn) return;

    const sortType = state.settings.sortType;
    // Steam API mostly supports custom sort direction only for certain types
    // We'll show it for Top Rated (0) and Most Recent (1)
    if (sortType == 0 || sortType == 1) {
        btn.style.display = "flex";
    } else {
        btn.style.display = "none";
    }

    const isDesc = state.settings.browseSortDir === "desc";
    btn.textContent = isDesc ? "▼" : "▲";
    btn.title = isDesc ? "Descending" : "Ascending";
}
