// Collections Tab Logic
import { invokeWithRetry, formatBytes, escapeHtml, escapeJs, createToast, showAlert, hideAlert, addLog, openUrl } from "../utils.js";
import { state } from "../state.js";
import { saveUiState } from "./settings.js";
import { installMod, openModDetail } from "./browse.js";
import { loadInstalledMods, loadContraptions } from "./installed.js";

// ── Search Collections ──────────────────────────
export async function searchCollections(reset = true) {
    if (reset) {
        state.nextCursor = "";
        state.currentCollections = [];
        // window.scrollTo(0, 0); // Maybe specific container?
    }

    const query = document.getElementById("collections-search-input").value.trim();
    const sortTypeSelector = document.getElementById("coll-sort-type");
    const sortType = parseInt(sortTypeSelector.value);

    const sortDaysSelector = document.getElementById("coll-sort-days");
    const sortDays = parseInt(sortDaysSelector.value || "7");

    // Update State
    state.settings.collSortType = sortType;
    state.settings.collSortDays = sortDays;
    saveUiState();
    const cursor = state.nextCursor;

    const loadingEl = document.getElementById("collections-loading");
    if (reset) {
        const list = document.getElementById("collections-list");
        if (list) list.innerHTML = "";
        if (loadingEl) loadingEl.classList.remove("hidden");
    }

    hideAlert("collections-alert");

    try {
        const data = await invokeWithRetry("search_collections_cmd", {
            query,
            cursor,
            sortType,
            days: sortDays
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
    const list = document.getElementById("collections-list");
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
    // Switch Tab
    document.querySelectorAll(".tab-content").forEach(s => {
        s.classList.remove("active");
        s.style.display = "none";
    });
    const detailTab = document.getElementById("tab-collection-detail");
    detailTab.classList.add("active");
    detailTab.style.display = "block";

    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    // Reset UI
    document.getElementById("coll-detail-loading").style.display = "flex";
    document.getElementById("coll-detail-content").style.display = "none";
    // Reset UI
    document.getElementById("coll-detail-loading").style.display = "flex";
    document.getElementById("coll-detail-content").style.display = "none";
    document.getElementById("coll-detail-items-list").innerHTML = "";
    document.getElementById("content").scrollTop = 0;

    // Pre-fetch caches if empty
    if (state.installedModsCache.length === 0) loadInstalledMods();
    if (state.contraptionsCache.length === 0) loadContraptions();

    try {
        const coll = await invokeWithRetry("get_collection_details_cmd", { collectionId: publishedFileId });
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
    // The backend returns { collection: {...}, items: [...] }
    const c = coll.collection || coll;

    const imgSrc = c.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 113' fill='%23333'%3E%3Crect width='200' height='113' /%3E%3C/svg%3E";
    document.getElementById("coll-detail-icon").src = imgSrc;
    document.getElementById("coll-detail-title").textContent = c.title;

    // Meta
    const date = c.time_updated ? new Date(c.time_updated * 1000).toLocaleDateString() : "Unknown";
    const author = c.creator_name || "Unknown";
    const metaEl = document.getElementById("coll-detail-meta");
    metaEl.innerHTML = `<span>By ${escapeHtml(author)}</span> • <span>Updated ${date}</span>`;

    document.getElementById("coll-detail-description").textContent = c.file_description || "";

    // Workshop Link
    const workshopLink = document.getElementById("coll-detail-workshop-link");
    if (workshopLink) {
        if (!c.publishedfileid) {
            workshopLink.style.display = "none";
        } else {
            const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${c.publishedfileid}`;
            console.log(`[Collections] Setting Workshop Link for ${c.publishedfileid}: ${url}`);
            workshopLink.style.display = "inline-flex";
            workshopLink.href = "javascript:void(0)";
            workshopLink.onclick = (e) => {
                e.preventDefault();
                openUrl(url);
            };
        }
    }

    // Render Items
    const list = document.getElementById("coll-detail-items-list");
    list.innerHTML = "";

    // Backend returns 'items' (enriched ModDetail list)
    // 'collection' (flattened) might have 'children' (raw list of IDs)
    // We want 'items'.
    // Save for Install All
    state.currentCollectionItems = coll.items || coll.children || [];
    const items = state.currentCollectionItems;

    if (!items || items.length === 0) {
        list.innerHTML = `<div style="padding: 20px; color: var(--text-muted);">No items in this collection.</div>`;
        return;
    }

    // Update count header
    document.getElementById("coll-detail-items-count").textContent = `Items in this Collection (${items.length})`;

    items.forEach(child => {
        // Child is a PublishedFileDetail (mostly)
        // Check if installed
        // Reuse install logic?

        const row = document.createElement("div");
        row.className = "installed-item"; // Reuse styling
        row.dataset.id = child.publishedfileid;
        row.style.cursor = "pointer"; // Indicate clickable

        // Navigate to mod detail on click (excluding install button)
        row.onclick = (e) => {
            // Prevent if clicking the install/delete button
            if (e.target.tagName === "BUTTON") return;
            openModDetail(child.publishedfileid);
        };

        let thumb = child.preview_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='%23222'%3E%3Crect width='64' height='64' /%3E%3C/svg%3E";

        // Check if installed in either cache
        const isModInstalled = state.installedModsCache.some(m => m.ugc_id === child.publishedfileid);
        const isContraptionInstalled = state.contraptionsCache.some(c => c.ugc_id === child.publishedfileid);
        const isInstalled = isModInstalled || isContraptionInstalled;

        // Determine type from tags: 'Contraptions' tag means Contraption, else Mod
        let typeLabel = "Mod";
        if (child.tags && Array.isArray(child.tags)) {
            const isContraption = child.tags.some(t => {
                const tagVal = (t.tag || t.display_name || "").toLowerCase();
                return tagVal === 'contraptions';
            });
            if (isContraption) typeLabel = "Contraption";
        }

        const isInvalid = child.result === 9 || child.result === 8;
        const invalidReason = child.result === 9 ? "Deleted/Private" : (child.result === 8 ? "Invalid" : "");

        row.innerHTML = `
            <img class="installed-item-img" src="${thumb}" alt="${escapeHtml(child.title)}" loading="lazy" />
            <div class="installed-item-info">
                <div class="installed-item-title">
                    ${escapeHtml(child.title)}
                    ${isInvalid ? `<span class="badge badge-error" style="margin-left: 8px; font-size: 10px; padding: 2px 6px;">${invalidReason}</span>` : ""}
                </div>
                <div class="installed-item-meta">
                    ${child.creator_name ? `<span>by ${escapeHtml(child.creator_name)}</span>` : ""}
                </div>
                <div class="installed-item-meta" style="opacity: 0.7;">${typeLabel}</div>
            </div>
            <div class="installed-item-actions">
                ${isInvalid
                ? `<button class="btn-outline" disabled title="This item is deleted or restricted by Steam">Unavailable</button>`
                : (isInstalled
                    ? `<button class="btn-outline installed" disabled>Installed</button>`
                    : `<button class="btn-primary small" onclick="installCollectionItem('${child.publishedfileid}', '${escapeJs(child.title)}', this)">Install</button>`)
            }
            </div>
        `;

        // Re-attach specific onclick for the button to prevent bubbling or handle separately?
        // the row.onclick handles filtering, but the button needs its own handler wired in HTML string?
        // The HTML string onclick="installCollectionItem" works, but we also verify e.target in row.onclick.

        list.appendChild(row);
    });
}

export function closeCollectionDetail() {
    if (window.switchTab) {
        window.switchTab(previousTab);
    }
}

export function toggleCollSortDir() {
    const current = state.settings.collSortDir || "desc";
    state.settings.collSortDir = current === "desc" ? "asc" : "desc";

    const btn = document.getElementById("coll-sort-dir-btn");
    if (btn) btn.textContent = state.settings.collSortDir === "asc" ? "▲" : "▼";

    saveUiState();
    searchCollections();
}

export async function installCollectionItem(id, title, btn) {
    if (btn.classList.contains("installed")) return;

    btn.textContent = "Queued";
    btn.disabled = true;

    try {
        await invokeWithRetry("install_mod", {
            workshopId: id,
            title: title
        });

        // Successfully enqueued
        addLog(`[Queue] Enqueued collection item: ${title} (${id})`, "info");

    } catch (e) {
        btn.textContent = "Install";
        btn.disabled = false;
        createToast("err-" + id, "error", "Queue Error", String(e));
    }
}

export async function installAllCollectionMods() {
    const list = document.getElementById("coll-detail-items-list");
    if (!list) return;

    const buttons = Array.from(list.querySelectorAll("button.btn-primary.small"));
    if (buttons.length === 0) {
        addLog("[Collections] No mods found to install in this collection.", "info");
        return;
    }

    addLog(`[Collections] Starting batch installation for ${buttons.length} items.`, "info");

    for (const btn of buttons) {
        if (!btn.disabled && btn.textContent === "Install") {
            // Trigger the click which calls installCollectionItem
            btn.click();
            // Small delay to prevent blocking the UI thread completely during DOM updates
            await new Promise(r => setTimeout(r, 50));
        }
    }
}

// ── Real-time Updates ───────────────────────────
window.addEventListener('item-installed', (event) => {
    const { id, title } = event.detail;
    console.log(`[Collections] Notified of installation: ${id}`);

    // Find the item in the collection list if it's currently open
    const detailList = document.getElementById("coll-detail-items-list");
    if (!detailList) return;

    // Use data-id to find the correct row
    const items = detailList.querySelectorAll(".installed-item");
    for (const item of items) {
        if (item.dataset.id === id) {
            const btn = item.querySelector("button");
            if (btn) {
                btn.textContent = "Installed";
                btn.className = "btn-outline installed";
                btn.disabled = true;
                btn.onclick = null;
            }
            break;
        }
    }
});

window.addEventListener('item-failed', (event) => {
    const { id } = event.detail;
    console.log(`[Collections] Notified of terminal failure: ${id}. Reverting button.`);

    const detailList = document.getElementById("coll-detail-items-list");
    if (!detailList) return;

    const items = detailList.querySelectorAll(".installed-item");
    for (const item of items) {
        if (item.dataset.id === id) {
            const btn = item.querySelector("button");
            if (btn) {
                btn.textContent = "Install";
                btn.className = "btn-primary small";
                btn.disabled = false;
            }
            break;
        }
    }
});

export function syncCollectionsUi() {
    console.log("[Collections] Syncing UI to state...");
    const selector = document.getElementById("coll-sort-type");
    if (selector) selector.value = state.settings.collSortType;

    const daysSelector = document.getElementById("coll-sort-days");
    if (daysSelector) daysSelector.value = state.settings.collSortDays || 7;

    const btn = document.getElementById("coll-sort-dir-btn");
    if (btn) btn.textContent = state.settings.collSortDir === "asc" ? "▲" : "▼";
}
