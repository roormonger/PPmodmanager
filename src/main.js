// ── Tauri invoke helper ─────────────────────────
function invoke(cmd, args) {
    return window.__TAURI__.core.invoke(cmd, args);
}

// ── State ───────────────────────────────────────
let currentMods = [];
let nextCursor = "";

// ── Tab Switching ───────────────────────────────
function switchTab(tab) {
    // Update nav buttons
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    // Update tab content
    document.querySelectorAll(".tab-content").forEach((section) => {
        section.classList.toggle("active", section.id === `tab-${tab}`);
    });
    // Auto-load installed mods when tab is selected
    if (tab === "installed") {
        loadInstalledMods();
    }
    // Render logs if settings
    if (tab === "settings") {
        renderLogs();
    }
}

// ── Alert Helpers ───────────────────────────────
function showAlert(containerId, message, type = "error") {
    const el = document.getElementById(containerId);
    el.className = `alert ${type}`;
    el.textContent = message;
    addLog(`[Alert] ${message}`, type);
}

function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    el.className = "alert hidden";
}

// ── Logs ────────────────────────────────────────
let appLogs = [];

function addLog(msg, type = "info") {
    const ts = new Date().toLocaleTimeString();
    appLogs.push({ ts, msg, type });
    // Keep last 100
    if (appLogs.length > 100) appLogs.shift();
    // If settings tab is active, render immediately
    if (document.getElementById("tab-settings").classList.contains("active")) {
        renderLogs();
    }
}

function renderLogs() {
    const container = document.getElementById("settings-logs");
    if (!container) return;

    if (appLogs.length === 0) {
        container.innerHTML = "No logs.";
        return;
    }

    container.innerHTML = appLogs.map(l =>
        `<div class="log-entry ${l.type}">` +
        `<span class="log-timestamp">[${l.ts}]</span>` +
        `<span>${escapeHtml(l.msg)}</span>` +
        `</div>`
    ).join("");
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function copyLogs() {
    const text = appLogs.map(l => `[${l.ts}] [${l.type}] ${l.msg}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
        alert("Logs copied to clipboard");
    }).catch(err => console.error("Failed to copy", err));
}

function clearLogs() {
    appLogs = [];
    renderLogs();
}

function toggleLogs() {
    const section = document.getElementById("logs-section");
    const content = document.getElementById("logs-content");
    section.classList.toggle("expanded");
    content.classList.toggle("expanded");
}

// ── Settings ────────────────────────────────────
async function loadSettings() {
    try {
        const config = await invoke("get_config");
        document.getElementById("api-key").value = config.steam_api_key || "";
        document.getElementById("pp-dir").value = config.people_playground_dir || "";
    } catch (e) {
        console.error("Failed to load settings:", e);
    }
}

async function saveSettings() {
    hideAlert("settings-alert");
    const apiKey = document.getElementById("api-key").value.trim();
    const ppDir = document.getElementById("pp-dir").value.trim();

    try {
        const msg = await invoke("save_config_cmd", {
            steamApiKey: apiKey,
            peoplePlaygroundDir: ppDir,
        });
        showAlert("settings-alert", msg, "success");
    } catch (e) {
        showAlert("settings-alert", "Error: " + e, "error");
    }
}

// ── Tags Logic ──────────────────────────────────
const ALL_TAGS = [
    "Contraptions", "Building", "Fun", "Realistic", "Destructible",
    "Electronics", "Vehicle", "Machine", "Utility", "Mods", "Human"
];
let selectedTags = [...ALL_TAGS]; // Default all enabled

function initTags() {
    // Load from storage
    const saved = localStorage.getItem("selected-tags");
    if (saved) {
        try {
            selectedTags = JSON.parse(saved);
        } catch (e) { console.error("Bad tag save", e); }
    }

    renderTagsDropdown();
}

function renderTagsDropdown() {
    const container = document.getElementById("tags-list");
    container.innerHTML = "";

    ALL_TAGS.forEach(tag => {
        const isChecked = selectedTags.includes(tag);
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
        container.appendChild(div);
    });

    updateTagLabel();
}

function toggleTagsDropdown() {
    const el = document.querySelector(".custom-select-options");
    el.classList.toggle("open");
}

// Close dropdown when clicking outside
document.addEventListener('click', function (event) {
    const isClickInside = document.getElementById('tags-dropdown').contains(event.target);
    if (!isClickInside) {
        document.querySelector(".custom-select-options").classList.remove("open");
    }
});

function toggleTag(tag) {
    if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag);
    } else {
        selectedTags.push(tag);
    }
    saveTags();
    renderTagsDropdown();
    // Debounce search? Or just search immediately
    searchMods();
}

function toggleAllTags() {
    if (selectedTags.length === ALL_TAGS.length) {
        selectedTags = []; // Deselect all
    } else {
        selectedTags = [...ALL_TAGS]; // Select all
    }
    saveTags();
    renderTagsDropdown();
    searchMods();
}

function updateTagLabel() {
    const label = document.getElementById("tags-label");
    if (selectedTags.length === ALL_TAGS.length) {
        label.textContent = "All Tags";
    } else if (selectedTags.length === 0) {
        label.textContent = "No Tags";
    } else {
        label.textContent = `${selectedTags.length} Selected`;
    }
}

function saveTags() {
    localStorage.setItem("selected-tags", JSON.stringify(selectedTags));
}

// ── Sort Direction ──────────────────────────────
let sortDesc = true; // Default Descending (Normal)

function initSortDir() {
    const saved = localStorage.getItem("sort-desc");
    if (saved !== null) {
        sortDesc = saved === "true";
    }
    updateSortDirBtn();
}

function toggleSortDir() {
    sortDesc = !sortDesc;
    localStorage.setItem("sort-desc", sortDesc);
    updateSortDirBtn();
    searchMods();
}

function updateSortDirBtn() {
    const btn = document.getElementById("sort-dir-btn");
    const sortType = document.getElementById("sort-type").value;

    // Only show for "Top Rated" (0) which supports Ascending (via query_type 10)
    if (sortType === "0") {
        btn.style.display = "flex";
    } else {
        btn.style.display = "none";
        // Reset to Desc (true) if hidden to avoid confusion?
        // But if user switches back, maybe remember?
        // Let's keep state but hide button.
    }

    btn.textContent = sortDesc ? "▼" : "▲";
    btn.title = sortDesc ? "Descending" : "Ascending";
}

// ── Mod Search ──────────────────────────────────
async function searchMods(cursor = "") {
    hideAlert("mods-alert");
    updateSortDirBtn(); // Ensure button visibility updates on search/change

    if (!cursor) {
        currentMods = [];
        document.getElementById("mods-grid").innerHTML = "";
    }

    const loadingEl = document.getElementById("mods-loading");
    loadingEl.classList.remove("hidden");
    document.getElementById("load-more-container").classList.add("hidden");

    // Load sort preferences
    let savedSortType = localStorage.getItem("sort-type");
    const savedSortDays = localStorage.getItem("sort-days");

    // Fix: "Last Updated" (20) causes issues, reset to Trend (3) if found
    if (savedSortType === "20") savedSortType = "3";

    if (savedSortType) document.getElementById("sort-type").value = savedSortType;
    if (savedSortDays) document.getElementById("sort-days").value = savedSortDays;

    const query = document.getElementById("search-input").value.trim();
    let sortType = parseInt(document.getElementById("sort-type").value); // Let be mutable for mapping
    const sortDays = parseInt(document.getElementById("sort-days").value);

    // Apply Sort Direction Mapping
    // API limitation: Standard queries are usually Descending. Avoid mapping unless we know a specific ID.
    // 0 (Vote) -> 10 (VoteAsc)?
    if (!sortDesc) {
        if (sortType === 0) {
            sortType = 10; // RankedByTotalVotesAsc
        }
        // Add others if found. For now, only Vote works reliably Ascending.
        // If user tries Asc on Date, it might ignore it.
    }

    // Filter tags logic:
    // If ALL tags are selected, we send empty list (implied "show all" or "don't filter").
    // If SOME are selected, we send them.
    // If NONE are selected, we send empty list (Steam gives everything usually, or nothing?).
    // Actually, if we want to filter to ONLY these tags, we send them.
    // Steam "requiredtags" means "Must have ALL (if match_all=true) or ANY (if match_all=false)".
    // Backend sets match_all=false.
    // So if I select "Fun", "Vehicle". It shows mods with Fun OR Vehicle.
    // That matches "Show results for mods with those tags".
    // If I select ALL, it shows mods with ANY of those tags. Since almost all mods have at least one tag, it effectively shows everything.

    // However, if we don't send `requiredtags` at all, Steam shows everything.
    // If we send ALL known tags, it shows mods that have at least one of them.
    // Effectively similar result.
    // Let's send `selectedTags`.

    let tagsToSend = selectedTags.length === ALL_TAGS.length ? [] : selectedTags;
    // Actually, user explicitly said "only show results for mods with those tags".
    // If they uncheck "Contraption", they might NOT want to see it?
    // Usually "Filter" means "Restrict to these".
    // If I check "Vehicle", I ONLY see Vehicles. (Logic: Has Tag 'Vehicle').
    // If I check "Vehicle" and "Fun". I see Vehicles OR Fun stuff.
    // If I have everything checked, I see everything.
    // So sending `selectedTags` is correct.
    // Optimization: If selectedTags.length == ALL_TAGS.length, sending nothing is often safer/faster default
    // UNLESS there are mods with NO tags?
    // Let's send nothing if all are selected to avoid huge URL param.
    if (selectedTags.length === ALL_TAGS.length) tagsToSend = [];
    // Wait, if I explicitly uncheck "Human", I want to see everything EXCEPT "Human"?
    // No, standard filter behavior is inclusive. "Show me X".
    // If I uncheck "Human", I'm just not asking to see "Human". But if a mod is "Vehicle", I see it.
    // So "Human" mods will only appear if they ALSO have "Vehicle".
    // A mod that is "Human" AND "Vehicle" will be SHOWN (because it matches Vehicle).
    // This is "Match Any" logic. It works.

    try {
        const data = await invoke("search_mods_cmd", {
            query,
            cursor,
            sortType,
            days: sortDays,
            requiredTags: tagsToSend
        });
        addLog(`[Search] Got ${data?.publishedfiledetails?.length || 0} items. Next cursor: ${data?.next_cursor ? "Yes" : "No"}`, "info");

        if (data && data.publishedfiledetails) {
            if (data.publishedfiledetails.length === 0) {
                nextCursor = "";
                renderMods();
                return;
            }
            if (!cursor) {
                currentMods = data.publishedfiledetails;
            } else {
                currentMods = [...currentMods, ...data.publishedfiledetails];
            }
            nextCursor = data.next_cursor || "";
            addLog(`[Search] Total: ${currentMods.length}. Next cursor: ${nextCursor.substring(0, 10)}...`, "info");
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

function renderMods() {
    const grid = document.getElementById("mods-grid");
    grid.innerHTML = "";

    // Filter out installed mods from browse results
    const browseMods = currentMods.filter(mod =>
        !installedModsCache.some(m => m.ugc_id === mod.publishedfileid)
    );

    browseMods.forEach((mod) => {
        const card = document.createElement("div");
        card.className = "mod-card";
        const date = mod.time_updated
            ? new Date(mod.time_updated * 1000).toLocaleDateString()
            : "";
        const imgSrc = mod.preview_url || "https://via.placeholder.com/300x300?text=No+Image";

        // Star rating from vote_data.score (0-1 → 5 stars)
        const score = mod.vote_data ? mod.vote_data.score : 0;
        const starCount = Math.round(score * 5);
        let starsHtml = "";
        for (let i = 1; i <= 5; i++) {
            starsHtml += `<span class="star ${i <= starCount ? 'filled' : ''}">★</span>`;
        }

        const author = mod.creator_name || "";

        card.innerHTML = `
            <img class="mod-card-img" src="${imgSrc}" alt="${escapeHtml(mod.title)}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'" />
            <div class="mod-card-body">
                <div class="mod-card-stars">${starsHtml}</div>
                <div class="mod-card-title">${escapeHtml(mod.title)}</div>
                ${author ? `<div class="mod-card-author">by ${escapeHtml(author)}</div>` : ""}
            </div>
            <div class="mod-card-footer">
                <button class="install-btn" onclick="event.stopPropagation(); installMod('${mod.publishedfileid}', '${escapeHtml(mod.title).replace(/'/g, "\\'")}'  , this)">Install</button>
            </div>
        `;
        card.style.cursor = "pointer";
        card.onclick = () => openModDetail(mod.publishedfileid);
        grid.appendChild(card);
    });

    // Show/hide load more / infinite scroll trigger
    const loadMoreEl = document.getElementById("load-more-container");
    if (nextCursor) {
        loadMoreEl.classList.remove("hidden");
        // Re-observe if we have a cursor
        if (observer) observer.observe(loadMoreEl);
    } else {
        loadMoreEl.classList.add("hidden");
    }
}

function loadMore() {
    if (nextCursor) {
        addLog("[InfiniteScroll] Loading more...", "info");
        searchMods(nextCursor);
    }
}

// ── Infinite Scroll Observer ────────────────────
let observer;
function setupInfiniteScroll() {
    const options = {
        root: null, // viewport
        rootMargin: "0px",
        threshold: 0.1,
    };

    observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting && nextCursor) {
                // addLog("[InfiniteScroll] Intersection detected", "info");
                loadMore();
            }
        });
    }, options);

    const target = document.getElementById("load-more-container");
    if (target) observer.observe(target);
}

// ── Toast Notifications ─────────────────────────
function createToast(id, type, title, msg) {
    addLog(`[Toast] ${title}: ${msg}`, type);
    const container = document.getElementById("toast-container");
    // Remove existing toast with same id
    const existing = document.getElementById(`toast-${id}`);
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.id = `toast-${id}`;

    const icons = { downloading: "⬇️", success: "✅", error: "❌" };
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || ""}</span>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-msg">${escapeHtml(msg)}</div>
        </div>
        <div class="toast-close">×</div>
        <div class="toast-progress"></div>
    `;

    // Click to dismiss
    toast.onclick = () => {
        toast.classList.add("removing");
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);
    return toast;
}

function updateToast(id, type, title, msg, autoRemoveMs = 0) {
    const toast = document.getElementById(`toast-${id}`);
    if (!toast) return createToast(id, type, title, msg);

    const icons = { downloading: "⬇️", success: "✅", error: "❌" };
    toast.className = `toast ${type}`;
    toast.querySelector(".toast-icon").textContent = icons[type] || "";
    toast.querySelector(".toast-title").textContent = title;
    toast.querySelector(".toast-msg").textContent = msg;

    if (autoRemoveMs > 0) {
        setTimeout(() => {
            toast.classList.add("removing");
            setTimeout(() => toast.remove(), 300);
        }, autoRemoveMs);
    }
    return toast;
}

// ── Download Queue ──────────────────────────────
let downloadQueue = [];
let isDownloading = false;

function installMod(workshopId, modTitle, btnElement) {
    // Add to queue
    if (btnElement.disabled) return;

    btnElement.disabled = true;
    btnElement.classList.add("installing");
    btnElement.textContent = "Queued";

    downloadQueue.push({ workshopId, modTitle, btnElement });
    updateDownloadManagerUI();
    processDownloadQueue();
}

async function processDownloadQueue() {
    if (isDownloading || downloadQueue.length === 0) return;

    isDownloading = true;
    const current = downloadQueue[0];

    // Update button state
    current.btnElement.textContent = "Downloading...";
    updateDownloadManagerUI();

    try {
        await invoke("install_mod", { workshopId: current.workshopId });

        // Success
        current.btnElement.textContent = "✓ Installed";
        current.btnElement.classList.remove("installing");

        // Brief success toast or just let the button show it?
        // User wanted less clutter. Button change is enough + removal from queue toast.

        setTimeout(() => {
            current.btnElement.textContent = "Install";
            current.btnElement.disabled = false;
        }, 3000);

    } catch (e) {
        // Error - Show specific error toast because it's important
        current.btnElement.textContent = "Failed";
        current.btnElement.classList.remove("installing");
        createToast(current.workshopId, "error", current.modTitle, String(e), 5000);

        setTimeout(() => {
            current.btnElement.textContent = "Install";
            current.btnElement.disabled = false;
        }, 3000);
    }

    // Remove from queue and continue
    downloadQueue.shift();
    isDownloading = false;
    updateDownloadManagerUI();
    processDownloadQueue();
}

function updateDownloadManagerUI() {
    const container = document.getElementById("toast-container");
    let toast = document.getElementById("toast-download-manager");

    // If empty, remove toast
    if (downloadQueue.length === 0 && !isDownloading) {
        if (toast) {
            toast.classList.add("removing");
            setTimeout(() => { if (toast) toast.remove(); }, 300);
        }
        return;
    }

    const current = downloadQueue[0];
    const count = downloadQueue.length - 1;
    const title = current ? current.modTitle : "Finishing...";

    let msg = "Processing...";
    if (count > 0) {
        msg = `+${count} more in queue`;
    } else {
        msg = "Please wait...";
    }

    if (!toast) {
        toast = document.createElement("div");
        toast.className = "toast downloading";
        toast.id = "toast-download-manager";
        toast.style.zIndex = "9999"; // Ensure on top
        container.appendChild(toast);
    }

    // Check if class is correct (might have been removed)
    if (toast.classList.contains("removing")) toast.classList.remove("removing");

    toast.innerHTML = `
        <span class="toast-icon">⬇️</span>
        <div class="toast-body">
            <div class="toast-title">Downloading ${escapeHtml(title)}</div>
            <div class="toast-msg">${escapeHtml(msg)}</div>
        </div>
        <div class="toast-progress"></div>
    `;
}
// ── Utilities ───────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

function formatBytes(bytes) {
    const n = parseInt(bytes) || 0;
    if (n === 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(n) / Math.log(1024));
    return (n / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

function formatNumber(n) {
    return (n || 0).toLocaleString();
}

function formatDate(ts) {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric"
    });
}

function renderStars(score, containerId) {
    const el = document.getElementById(containerId);
    const starCount = Math.round((score || 0) * 5);
    let html = "";
    for (let i = 1; i <= 5; i++) {
        html += `<span class="star ${i <= starCount ? 'filled' : ''}">★</span>`;
    }
    const totalVotes = Math.round(score * 100); // approximate
    html += `<span class="rating-text">${starCount}/5</span>`;
    el.innerHTML = html;
}

// ── Mod Detail View ─────────────────────────────
let previousTab = "browse";

async function openModDetail(publishedFileId) {
    // Detect which tab we came from
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && activeTab.id !== "tab-detail") {
        previousTab = activeTab.id.replace("tab-", "");
    }

    // Switch to detail tab
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById("tab-detail").classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    // Show loading
    document.getElementById("detail-loading").style.display = "flex";
    document.getElementById("detail-content").style.display = "none";

    // Scroll to top
    document.getElementById("content").scrollTop = 0;

    try {
        const mod = await invoke("get_mod_details_cmd", { publishedFileId: publishedFileId });
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

    // Title & stars
    document.getElementById("detail-title").textContent = mod.title || "Untitled";
    renderStars(mod.vote_data ? mod.vote_data.score : 0, "detail-stars");

    // Icon
    const icon = document.getElementById("detail-icon");
    icon.src = mod.preview_url || "";
    icon.alt = mod.title || "";

    // Media gallery
    const allMedia = [];

    // Main preview image first
    if (mod.preview_url) {
        allMedia.push({ type: "image", url: mod.preview_url });
    }

    // Additional previews
    if (mod.previews && mod.previews.length > 0) {
        for (const p of mod.previews) {
            if (p.preview_type === 1 && p.youtubevideoid) {
                allMedia.push({ type: "video", videoId: p.youtubevideoid });
            } else if (p.url) {
                allMedia.push({ type: "image", url: p.url });
            }
        }
    }

    const mainEl = document.getElementById("detail-media-main");
    const thumbsEl = document.getElementById("detail-thumbnails");

    // Render thumbnails
    thumbsEl.innerHTML = "";
    allMedia.forEach((media, i) => {
        if (media.type === "video") {
            const wrap = document.createElement("div");
            wrap.className = `detail-thumb-video ${i === 0 ? "active" : ""}`;
            wrap.innerHTML = `<img src="https://img.youtube.com/vi/${media.videoId}/mqdefault.jpg" />`;
            wrap.onclick = () => selectMedia(i, allMedia);
            thumbsEl.appendChild(wrap);
        } else {
            const img = document.createElement("img");
            img.className = `detail-thumb ${i === 0 ? "active" : ""}`;
            img.src = media.url;
            img.onclick = () => selectMedia(i, allMedia);
            thumbsEl.appendChild(img);
        }
    });

    // Show first media
    if (allMedia.length > 0) {
        selectMedia(0, allMedia);
    } else {
        mainEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">No media available</div>`;
    }

    // Hide thumbnails if only one item
    thumbsEl.style.display = allMedia.length <= 1 ? "none" : "flex";

    // Metadata
    document.getElementById("detail-author").textContent = mod.creator_name || "Unknown";
    document.getElementById("detail-filesize").textContent = formatBytes(mod.file_size);
    document.getElementById("detail-created").textContent = formatDate(mod.time_created);
    document.getElementById("detail-updated").textContent = formatDate(mod.time_updated);
    document.getElementById("detail-subs").textContent = formatNumber(mod.subscriptions);
    document.getElementById("detail-favs").textContent = formatNumber(mod.favorited);
    document.getElementById("detail-views").textContent = formatNumber(mod.views);

    // Tags
    const tagsEl = document.getElementById("detail-tags");
    tagsEl.innerHTML = "";
    if (mod.tags && mod.tags.length > 0) {
        mod.tags.forEach(t => {
            const tag = document.createElement("span");
            tag.className = "detail-tag";
            tag.textContent = t.display_name || t.tag;
            tagsEl.appendChild(tag);
        });
    }

    // Description
    document.getElementById("detail-description").textContent = mod.file_description || "No description available.";

    // Install button
    const installBtn = document.getElementById("detail-install-btn");
    const title = mod.title || "Mod";

    // Check installed
    const isInstalled = installedModsCache.some(m => m.ugc_id === mod.publishedfileid);

    installBtn.onclick = () => installMod(mod.publishedfileid, title, installBtn);

    if (isInstalled) {
        installBtn.textContent = "Installed";
        installBtn.classList.add("installed");
        installBtn.disabled = true;
    } else {
        installBtn.textContent = "Install Mod";
        installBtn.classList.remove("installed");
        installBtn.disabled = false;
    }

    // Workshop link
    const link = document.getElementById("detail-workshop-link");
    link.href = `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`;
}

function selectMedia(index, allMedia) {
    const mainEl = document.getElementById("detail-media-main");
    const media = allMedia[index];

    if (media.type === "video") {
        mainEl.innerHTML = `<iframe src="https://www.youtube.com/embed/${media.videoId}?autoplay=0" allowfullscreen></iframe>`;
    } else {
        mainEl.innerHTML = `<img src="${media.url}" alt="" />`;
    }

    // Update active thumbnail
    const thumbs = document.getElementById("detail-thumbnails").children;
    for (let i = 0; i < thumbs.length; i++) {
        thumbs[i].classList.toggle("active", i === index);
    }
}

function closeDetail() {
    // Stop any playing YouTube iframes
    document.querySelectorAll("#detail-media-main iframe").forEach(iframe => {
        iframe.src = "";
    });

    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById(`tab-${previousTab}`).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === previousTab);
    });
}

// ── Keyboard shortcut: Enter to search ──────────
document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchMods();
});

// ── Init ────────────────────────────────────────

async function getAppVersion() {
    try {
        const ver = await invoke("get_app_version");
        const sidebarEl = document.getElementById("app-version-sidebar");
        const settingsEl = document.getElementById("update-status"); // existing one

        if (sidebarEl) sidebarEl.textContent = `v${ver}`;
        // Settings element is also updated by checkUpdates, but good to have base version immediately
        if (settingsEl && settingsEl.textContent === "v0.5.1") {
            settingsEl.textContent = `v${ver}`;
        }
    } catch (e) {
        console.error("Failed to get app version", e);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    getAppVersion();
    loadSettings();
    initTags();
    initSortDir();
    await loadInstalledMods();
    setupInfiniteScroll();
    searchMods();
});

// ── Installed Mods ──────────────────────────────
let installedModsCache = [];

async function loadInstalledMods() {
    const list = document.getElementById("installed-list");
    const loading = document.getElementById("installed-loading");
    const empty = document.getElementById("installed-empty");
    const alert = document.getElementById("installed-alert");

    list.innerHTML = "";
    empty.style.display = "none";
    alert.classList.add("hidden");
    loading.style.display = "flex";

    try {
        const mods = await invoke("list_installed_mods");

        if (mods.length === 0) {
            loading.style.display = "none";
            empty.style.display = "block";
            return;
        }

        installedModsCache = mods;

        // Fetch details for each mod from Steam API to get titles/images
        const enriched = await enrichInstalledMods(mods);
        loading.style.display = "none";
        renderInstalledMods(enriched);
    } catch (e) {
        loading.style.display = "none";
        showAlert("installed-alert", String(e));
    }
}

async function enrichInstalledMods(mods) {
    const results = [];
    for (const mod of mods) {
        // Start with local metadata from JSON
        let enriched = {
            folder_name: mod.folder_name,
            folder_size: mod.folder_size,
            ugc_id: mod.ugc_id,
            title: mod.name || mod.folder_name,
            preview_url: mod.thumbnail_data || "",
            file_description: mod.description || "",
            creator_name: mod.author || "",
        };

        // If we have a workshop/UGC ID, try to enrich with Steam API
        if (mod.ugc_id) {
            try {
                const detail = await invoke("get_mod_details_cmd", { publishedFileId: mod.ugc_id });
                enriched.title = detail.title || enriched.title;
                enriched.preview_url = detail.preview_url || enriched.preview_url;
                enriched.file_description = detail.file_description || enriched.file_description;
                enriched.creator_name = detail.creator_name || enriched.creator_name;
            } catch {
                // Steam API failed, keep local data
            }
        }

        results.push(enriched);
    }
    return results;
}

function renderInstalledMods(mods) {
    const list = document.getElementById("installed-list");
    list.innerHTML = "";

    mods.forEach((mod) => {
        const row = document.createElement("div");
        row.className = "installed-item";

        const imgSrc = mod.preview_url || "https://via.placeholder.com/64x64?text=?";
        const desc = mod.file_description ? escapeHtml(mod.file_description.substring(0, 120)) : "";

        row.innerHTML = `
            <img class="installed-item-img" src="${imgSrc}" alt="${escapeHtml(mod.title)}" onerror="this.src='https://via.placeholder.com/64x64?text=?'" />
            <div class="installed-item-info">
                <div class="installed-item-title">${escapeHtml(mod.title)}</div>
                <div class="installed-item-meta">
                    ${mod.creator_name ? `<span>by ${escapeHtml(mod.creator_name)}</span>` : ""}
                    <span>${formatBytes(mod.folder_size)}</span>
                    ${mod.ugc_id ? `<span>ID: ${mod.ugc_id}</span>` : ""}
                </div>
                ${desc ? `<div class="installed-item-desc">${desc}</div>` : ""}
            </div>
            <button class="installed-delete-btn" onclick="event.stopPropagation(); deleteInstalledMod('${escapeHtml(mod.folder_name).replace(/'/g, "\\'")}', this)">Delete</button>
        `;

        // Only make clickable to detail if we have a workshop ID
        if (mod.ugc_id) {
            row.onclick = () => openModDetail(mod.ugc_id);
        } else {
            row.style.cursor = "default";
        }
        list.appendChild(row);
    });
}

async function deleteInstalledMod(folderName, btn) {
    // Two-click confirm
    if (!btn.classList.contains("confirming")) {
        btn.classList.add("confirming");
        btn.textContent = "Confirm?";
        setTimeout(() => {
            if (btn.classList.contains("confirming")) {
                btn.classList.remove("confirming");
                btn.textContent = "Delete";
            }
        }, 3000);
        return;
    }

    btn.disabled = true;
    btn.textContent = "Deleting...";

    try {
        await invoke("delete_installed_mod", { workshopId: folderName });
        createToast(folderName, "success", "Mod deleted", `${folderName} removed.`, 3000);
        loadInstalledMods();
    } catch (e) {
        btn.disabled = false;
        btn.classList.remove("confirming");
        btn.textContent = "Delete";
        createToast(folderName, "error", "Delete failed", String(e), 5000);
    }
}

// ── Zoom Slider ─────────────────────────────────
const zoomSlider = document.getElementById("zoom-slider");
if (zoomSlider) {
    // Set initial value
    const savedZoom = localStorage.getItem("mod-card-zoom");
    if (savedZoom) {
        zoomSlider.value = savedZoom;
        document.documentElement.style.setProperty("--card-min-width", savedZoom + "px");
    } else {
        // Default matches CSS
        zoomSlider.value = 250;
        document.documentElement.style.setProperty("--card-min-width", "250px");
    }

    zoomSlider.addEventListener("input", (e) => {
        const size = e.target.value;
        document.documentElement.style.setProperty("--card-min-width", size + "px");
        localStorage.setItem("mod-card-zoom", size);
    });
}

// ── Auto-Updater ────────────────────────────────
async function checkUpdates() {
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
            if (status) status.textContent = "Up to date (v0.5.1)";
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

async function installUpdate(btn) {
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
