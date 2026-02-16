// Collections Tab Logic
import { invokeWithRetry, formatBytes, escapeHtml, escapeJs, createToast, showAlert, hideAlert, addLog } from "../utils.js";
import { state } from "../state.js";
import { installMod } from "./browse.js"; // Reuse mod installation logic if needed, but collections have own logic?
// Actually collections install items which are mods.

// ── Search Collections ──────────────────────────
export async function searchCollections(reset = true) {
    if (reset) {
        state.nextCursor = "";
        state.currentCollections = [];
        // window.scrollTo(0, 0); // Maybe specific container?
    }

    const query = document.getElementById("collections-search-input").value.trim();
    const sortType = parseInt(document.getElementById("coll-sort-type").value);
    const cursor = state.nextCursor;

    const loadingEl = document.getElementById("collections-loading");
    if (reset) {
        document.getElementById("collections-grid").innerHTML = "";
        if (loadingEl) loadingEl.classList.remove("hidden");
    }

    hideAlert("collections-alert");

    try {
        const data = await invokeWithRetry("search_collections_cmd", {
            query,
            cursor,
            sortType,
            days: 7 // hardcoded for now or add UI
        });

        addLog(`[Collections] Got ${data?.publishedfiledetails?.length || 0} items.`, "info");

        if (data && data.publishedfiledetails) {
            if (data.publishedfiledetails.length === 0) {
                state.nextCursor = "";
                renderCollections();
                return;
            }

            if (!cursor) {
                state.currentCollections = data.publishedfiledetails;
            } else {
                state.currentCollections = [...state.currentCollections, ...data.publishedfiledetails];
            }
            state.nextCursor = data.next_cursor || "";
            renderCollections();
        }
    } catch (e) {
        showAlert("collections-alert", "Failed to search collections: " + e);
    } finally {
        if (loadingEl) loadingEl.classList.add("hidden");
    }
}

export function renderCollections() {
    const list = document.getElementById("collections-grid");
    if (!list) return;
    list.innerHTML = "";

    if (state.currentCollections.length === 0) {
        list.innerHTML = `<div class="hidden">No collections found.</div>`; // Use class hidden logic or just text?
        // Actually original code had logic to show "No collections found" text if empty after load
        // But here let's just show a message.
        const msg = document.createElement("div");
        msg.style.gridColumn = "1/-1";
        msg.style.textAlign = "center";
        msg.style.padding = "40px";
        msg.style.color = "var(--text-muted)";
        msg.textContent = "No collections found.";
        list.appendChild(msg);
        return;
    }

    state.currentCollections.forEach(coll => {
        const item = document.createElement("div");
        item.className = "collection-item";

        const imgSrc = coll.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 68' fill='%23333'%3E%3Crect width='120' height='68' /%3E%3C/svg%3E";

        const score = coll.vote_data ? coll.vote_data.score : 0;
        const starCount = Math.round(score * 5).toFixed(1);

        const childCount = coll.children ? coll.children.length : 0; // children might not be populated in search result?
        // Search result usually doesn't have children detailed logic unless we fetch details.
        // But let's assume Basic info.

        item.innerHTML = `
            <img class="collection-item-img" src="${imgSrc}" alt="${escapeHtml(coll.title)}" loading="lazy" />
            <div class="collection-item-info">
                <div class="collection-item-title">${escapeHtml(coll.title)}</div>
                <div class="collection-item-meta">
                    <span>By ${escapeHtml(coll.creator_name || "Unknown")}</span>
                    <div class="collection-item-stars">
                        <span class="star filled">★</span> ${starCount}
                    </div>
                </div>
                <div class="collection-item-desc">${escapeHtml(coll.short_description || "")}</div>
            </div>
            <div class="collection-item-arrow">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"></path>
                </svg>
            </div>
        `;

        item.onclick = () => openCollectionDetail(coll.publishedfileid);
        list.appendChild(item);
    });
}

// ── Collection Detail ───────────────────────────
// We need to track previous tab here too? Or reuse the global one?
// Since modules isolate scope, we might need a shared "router" state or just check DOM.

let previousTab = "collections";

export async function openCollectionDetail(publishedFileId) {
    const activeTab = document.querySelector(".tab-content.active");
    if (activeTab && activeTab.id !== "tab-collection-detail") {
        previousTab = activeTab.id.replace("tab-", "");
    }

    // Switch Tab
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById("tab-collection-detail").classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    // Reset UI
    document.getElementById("coll-detail-loading").style.display = "flex";
    document.getElementById("coll-detail-content").style.display = "none";
    document.getElementById("coll-detail-items").innerHTML = "";
    document.getElementById("content").scrollTop = 0;

    try {
        const coll = await invokeWithRetry("get_collection_details_cmd", { publishedFileId: publishedFileId });
        renderCollectionDetail(coll);
    } catch (e) {
        document.getElementById("coll-detail-loading").style.display = "none";
        showAlert("collections-alert", "Failed to load collection details: " + e);
        // But we are on detail page... maybe show error there?
        // For now, simple alert or console.
        console.error(e);
    }
}

function renderCollectionDetail(coll) {
    document.getElementById("coll-detail-loading").style.display = "none";
    document.getElementById("coll-detail-content").style.display = "block";

    // Header Info
    const imgSrc = coll.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 113' fill='%23333'%3E%3Crect width='200' height='113' /%3E%3C/svg%3E";
    document.getElementById("coll-detail-icon").src = imgSrc;
    document.getElementById("coll-detail-title").textContent = coll.title;

    // Meta
    const date = coll.time_updated ? new Date(coll.time_updated * 1000).toLocaleDateString() : "Unknown";
    const author = coll.creator_name || "Unknown";
    const metaEl = document.getElementById("coll-detail-meta");
    metaEl.innerHTML = `<span>By ${escapeHtml(author)}</span> • <span>Updated ${date}</span>`;

    document.getElementById("coll-detail-description").textContent = coll.file_description || "";

    // Render Items
    const list = document.getElementById("coll-detail-items");
    list.innerHTML = "";

    if (!coll.children || coll.children.length === 0) {
        list.innerHTML = `<div style="padding: 20px; color: var(--text-muted);">No items in this collection.</div>`;
        return;
    }

    coll.children.forEach(child => {
        // Child is a PublishedFileDetail (mostly)
        // Check if installed
        // Reuse install logic?

        const row = document.createElement("div");
        row.className = "installed-item"; // Reuse styling

        let thumb = child.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='%23222'%3E%3Crect width='64' height='64' /%3E%3C/svg%3E";

        const isInstalled = state.installedModsCache.some(m => m.ugc_id === child.publishedfileid);

        row.innerHTML = `
            <img class="installed-item-img" src="${thumb}" alt="${escapeHtml(child.title)}" loading="lazy" />
            <div class="installed-item-info">
                <div class="installed-item-title">${escapeHtml(child.title)}</div>
            </div>
            <button class="collection-install-btn ${isInstalled ? 'installed' : ''}" 
                onclick="event.stopPropagation(); installCollectionItem('${child.publishedfileid}', '${escapeJs(child.title)}', this)">
                ${isInstalled ? 'Installed' : 'Install'}
            </button>
        `;
        list.appendChild(row);
    });
}

export function closeCollectionDetail() {
    if (window.switchTab) {
        window.switchTab(previousTab);
    }
}

export async function installCollectionItem(id, title, btn) {
    if (btn.classList.contains("installed")) return;

    // logic similar to installMod but specifically for collection item button style
    // We can actually just call installMod from browse.js if we import it? 
    // Yes, let's reuse installMod logic but adapted for this button.

    // Creating a wrapper or just duplicating logic for safety/simplicity
    btn.textContent = "Installing...";
    btn.disabled = true;

    try {
        await invokeWithRetry("install_mod_cmd", { publishedFileId: id });
        btn.textContent = "Installed";
        btn.classList.add("installed");
        btn.onclick = null;
        createToast(id, "success", "Installed", `${title} ready.`);
    } catch (e) {
        btn.textContent = "Install";
        btn.disabled = false;
        createToast("err-" + id, "error", "Failed", String(e));
    }
}
