import { state } from "./state.js";

const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

let queueList = document.getElementById('download-queue-list');
let sidebarActivity = document.getElementById('sidebar-activity');

// Track processed IDs in this session to avoid redundant event dispatches or state pushes
const completedIds = new Set();

export async function initDownloadQueue() {
    // 1. Initial State
    const initialState = await invoke('get_download_state');
    renderQueue(initialState);

    // 2. Listen for updates
    await listen('download-queue-update', (event) => {
        const payload = event.payload;
        console.log('Download queue update:', payload);

        // Handle completion/failure logic for real-time awareness
        if (payload.active) {
            const task = payload.active;
            if (task.status === 'completed' && !completedIds.has(task.id)) {
                completedIds.add(task.id);
                handleTaskCompletion(task);
            } else if (task.status === 'failed' && !completedIds.has(task.id)) {
                completedIds.add(task.id);
                handleTaskFailure(task);
            }
        }

        renderQueue(payload);
    });
}

function handleTaskFailure(task) {
    console.error(`[Queue] Task failed: ${task.title} (${task.id}). Error: ${task.message}`);

    // Broadcast event for other tabs to react (e.g. reset buttons)
    const event = new CustomEvent('item-failed', {
        detail: { id: task.id, title: task.title, error: task.message }
    });
    window.dispatchEvent(event);
}

function handleTaskCompletion(task) {
    console.log(`[Queue] Task completed: ${task.title} (${task.id}) as ${task.content_type}`);

    // Update State Cache
    if (task.content_type === 'mod') {
        if (!state.installedModsCache.some(m => m.ugc_id === task.id)) {
            state.installedModsCache.push({ ugc_id: task.id, title: task.title });
        }
    } else if (task.content_type === 'contraption') {
        if (!state.contraptionsCache.some(c => c.ugc_id === task.id)) {
            state.contraptionsCache.push({ ugc_id: task.id, title: task.title });
        }
    }

    // Broadcast event for other tabs to react
    const event = new CustomEvent('item-installed', {
        detail: { id: task.id, type: task.content_type, title: task.title }
    });
    window.dispatchEvent(event);
}

function renderQueue(state) {
    const { pending, active } = state;

    // Show/Hide sidebar section
    if (!active && pending.length === 0) {
        sidebarActivity.classList.add('hidden');
        return;
    }
    sidebarActivity.classList.remove('hidden');

    // Create a combined list for rendering
    let html = '';

    // Render Active Task
    if (active) {
        html += renderTaskCard(active, true);
    }

    // Render Pending
    pending.forEach(task => {
        html += renderTaskCard(task, false);
    });

    queueList.innerHTML = html;
}

function renderTaskCard(task, isActive) {
    const statusClass = task.status; // downloading, pending, completed, failed
    const progress = (task.progress * 100).toFixed(0);

    return `
        <div class="download-card ${statusClass} ${isActive ? 'active' : ''}">
            <div class="download-info">
                <div class="download-title" title="${task.title}">${task.title}</div>
                <div class="download-status">${task.status === 'downloading' ? 'Downloading' : task.status}</div>
            </div>
            <div class="download-progress-container">
                <div class="download-progress-bar" style="width: ${progress}%"></div>
            </div>
            ${task.message && task.status === 'failed' ? `<div class="download-message">${task.message}</div>` : ''}
        </div>
    `;
}
