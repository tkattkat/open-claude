// Settings renderer

const claude = (window as any).claude;

interface KeyboardShortcuts {
  spotlight: string;
  newConversation: string;
  toggleSidebar: string;
}

interface Settings {
  spotlightKeybind: string;
  spotlightPersistHistory: boolean;
  keyboardShortcuts: KeyboardShortcuts;
}

// Default keyboard shortcuts
const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  spotlight: 'CommandOrControl+Shift+C',
  newConversation: 'CommandOrControl+N',
  toggleSidebar: 'CommandOrControl+B',
};

// DOM Elements
const persistHistoryCheckbox = document.getElementById('persist-history') as HTMLInputElement;

let currentSettings: Settings | null = null;
let activeRecordingInput: HTMLElement | null = null;
let pendingKeybind: string | null = null;

// Detect if we're on macOS
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

// Format keybind for display
function formatKeybind(keybind: string): string {
  return keybind
    .replace('CommandOrControl', isMac ? '\u2318' : 'Ctrl')
    .replace('Command', '\u2318')
    .replace('Control', 'Ctrl')
    .replace('Shift', '\u21E7')
    .replace('Alt', '\u2325')
    .replace('Option', '\u2325')
    .replace(/\+/g, ' + ');
}

// Convert key event to Electron accelerator format
function keyEventToAccelerator(e: KeyboardEvent): { accelerator: string; isComplete: boolean } {
  const parts: string[] = [];

  if (e.metaKey || e.ctrlKey) {
    parts.push('CommandOrControl');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  if (e.altKey) {
    parts.push('Alt');
  }

  // Get the key
  let key = e.key;

  // Check if this is a modifier-only press
  const isModifierOnly = ['Meta', 'Control', 'Shift', 'Alt'].includes(key);

  if (!isModifierOnly) {
    // Normalize key names
    if (key === ' ') key = 'Space';
    if (key.length === 1) key = key.toUpperCase();

    // Map special keys
    const keyMap: Record<string, string> = {
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'Escape': 'Escape',
      'Enter': 'Return',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Tab': 'Tab',
    };

    if (keyMap[key]) {
      key = keyMap[key];
    }

    parts.push(key);
  }

  return {
    accelerator: parts.join('+'),
    isComplete: !isModifierOnly && parts.length >= 2 // Need at least one modifier + one key
  };
}

// Get shortcut value by key
function getShortcutValue(key: keyof KeyboardShortcuts): string {
  if (!currentSettings) return DEFAULT_SHORTCUTS[key];
  const shortcuts = currentSettings.keyboardShortcuts || DEFAULT_SHORTCUTS;
  return shortcuts[key] || DEFAULT_SHORTCUTS[key];
}

// Update all display values
function updateDisplayValues() {
  if (!currentSettings) return;

  // Update spotlight display
  const spotlightDisplay = document.getElementById('spotlight-keybind-display');
  if (spotlightDisplay) {
    spotlightDisplay.textContent = formatKeybind(getShortcutValue('spotlight'));
  }

  // Update new conversation display
  const newConvDisplay = document.getElementById('new-conv-keybind-display');
  if (newConvDisplay) {
    newConvDisplay.textContent = formatKeybind(getShortcutValue('newConversation'));
  }

  // Update toggle sidebar display
  const sidebarDisplay = document.getElementById('sidebar-keybind-display');
  if (sidebarDisplay) {
    sidebarDisplay.textContent = formatKeybind(getShortcutValue('toggleSidebar'));
  }

  // Update persist history
  if (persistHistoryCheckbox) {
    persistHistoryCheckbox.checked = currentSettings.spotlightPersistHistory;
  }
}

// Load settings
async function loadSettings() {
  currentSettings = await claude.getSettings();

  // Ensure keyboardShortcuts exists with defaults
  if (currentSettings && !currentSettings.keyboardShortcuts) {
    currentSettings.keyboardShortcuts = { ...DEFAULT_SHORTCUTS };
    // Migrate old spotlightKeybind if exists
    if (currentSettings.spotlightKeybind) {
      currentSettings.keyboardShortcuts.spotlight = currentSettings.spotlightKeybind;
    }
  }

  updateDisplayValues();
}

// Save keyboard shortcut
async function saveKeyboardShortcut(shortcutKey: keyof KeyboardShortcuts, keybind: string) {
  if (!currentSettings) return;

  const shortcuts = currentSettings.keyboardShortcuts || { ...DEFAULT_SHORTCUTS };
  shortcuts[shortcutKey] = keybind;

  // Also update spotlightKeybind for backwards compatibility
  if (shortcutKey === 'spotlight') {
    currentSettings = await claude.saveSettings({
      keyboardShortcuts: shortcuts,
      spotlightKeybind: keybind
    });
  } else {
    currentSettings = await claude.saveSettings({ keyboardShortcuts: shortcuts });
  }

  updateDisplayValues();
}

// Save persist history
async function savePersistHistory(value: boolean) {
  if (!currentSettings) return;

  currentSettings = await claude.saveSettings({ spotlightPersistHistory: value });
}

// Stop recording and save if we have a valid keybind
function stopRecording(save: boolean) {
  if (!activeRecordingInput) return;

  const shortcutKey = activeRecordingInput.dataset.shortcut as keyof KeyboardShortcuts;
  const displayEl = activeRecordingInput.querySelector('.keybind-display') as HTMLElement;

  activeRecordingInput.classList.remove('recording');

  if (save && pendingKeybind && shortcutKey) {
    saveKeyboardShortcut(shortcutKey, pendingKeybind);
  } else if (currentSettings && displayEl) {
    displayEl.textContent = formatKeybind(getShortcutValue(shortcutKey));
  }

  activeRecordingInput = null;
  pendingKeybind = null;
}

// Set up keybind input handlers
function setupKeybindInput(inputEl: HTMLElement) {
  const shortcutKey = inputEl.dataset.shortcut as keyof KeyboardShortcuts;
  const displayEl = inputEl.querySelector('.keybind-display') as HTMLElement;

  inputEl.addEventListener('click', () => {
    if (activeRecordingInput === inputEl) return;

    // Stop any existing recording
    stopRecording(false);

    activeRecordingInput = inputEl;
    pendingKeybind = null;
    inputEl.classList.add('recording');
    if (displayEl) displayEl.textContent = 'Press keys...';
    inputEl.focus();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (activeRecordingInput !== inputEl) return;

    e.preventDefault();
    e.stopPropagation();

    // Handle Escape to cancel
    if (e.key === 'Escape') {
      stopRecording(false);
      return;
    }

    // Handle Enter to confirm
    if (e.key === 'Enter' && pendingKeybind) {
      stopRecording(true);
      return;
    }

    const result = keyEventToAccelerator(e);

    // Update display to show current keys being pressed
    if (result.accelerator && displayEl) {
      displayEl.textContent = formatKeybind(result.accelerator);

      // If we have a complete combo (modifier + key), store it as pending
      if (result.isComplete) {
        pendingKeybind = result.accelerator;
      }
    }
  });

  inputEl.addEventListener('blur', () => {
    // Save pending keybind on blur (clicking away)
    if (activeRecordingInput === inputEl) {
      stopRecording(!!pendingKeybind);
    }
  });
}

// Initialize all keybind inputs
function initializeKeybindInputs() {
  const keybindInputs = document.querySelectorAll('.keybind-input');
  keybindInputs.forEach(input => {
    setupKeybindInput(input as HTMLElement);
  });
}

// Persist history toggle
persistHistoryCheckbox?.addEventListener('change', () => {
  savePersistHistory(persistHistoryCheckbox.checked);
});

// MCP Server management
interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

interface MCPTool {
  name: string;
  description?: string;
}

interface MCPServerStatus {
  id: string;
  name: string;
  enabled: boolean;
  isConnected: boolean;
  tools: MCPTool[];
  error: string | null;
}

let mcpServers: MCPServer[] = [];
let mcpServerStatus: MCPServerStatus[] = [];
let editingServerId: string | null = null;

const serversList = document.getElementById('mcp-servers-list') as HTMLElement;
const addServerBtn = document.getElementById('add-mcp-server-btn') as HTMLElement;
const modal = document.getElementById('add-server-modal') as HTMLElement;
const modalTitle = document.getElementById('modal-title') as HTMLElement;
const closeModalBtn = document.getElementById('close-modal-btn') as HTMLElement;
const cancelModalBtn = document.getElementById('cancel-modal-btn') as HTMLElement;
const saveServerBtn = document.getElementById('save-server-btn') as HTMLElement;
const serverNameInput = document.getElementById('server-name') as HTMLInputElement;
const serverCommandInput = document.getElementById('server-command') as HTMLInputElement;
const serverArgsInput = document.getElementById('server-args') as HTMLInputElement;

async function loadMCPServers() {
  mcpServers = await claude.getMCPServers() || [];
  mcpServerStatus = await claude.getMCPServerStatus() || [];
  renderServersList();
}

function renderServersList() {
  if (!serversList) return;

  if (mcpServers.length === 0) {
    serversList.innerHTML = '<p style="text-align: center; color: rgba(128, 128, 128, 0.7); font-size: 13px; padding: 12px;">No MCP servers configured</p>';
    return;
  }

  serversList.innerHTML = mcpServers.map(server => {
    const status = mcpServerStatus.find(s => s.id === server.id);
    const isConnected = status?.isConnected || false;
    const tools = status?.tools || [];
    const toolCount = tools.length;

    let statusBadge = '';
    if (server.enabled) {
      if (isConnected) {
        statusBadge = `<span class="mcp-status connected">Connected</span>`;
      } else {
        statusBadge = `<span class="mcp-status disconnected">Disconnected</span>`;
      }
    } else {
      statusBadge = `<span class="mcp-status disabled">Disabled</span>`;
    }

    const toolsList = tools.length > 0
      ? `<div class="mcp-tools-list">${tools.map(t => `<span class="mcp-tool-badge" title="${escapeHtml(t.description || t.name)}">${escapeHtml(t.name)}</span>`).join('')}</div>`
      : (server.enabled && isConnected ? '<div class="mcp-no-tools">No tools available</div>' : '');

    return `
      <div class="mcp-server-item ${isConnected ? 'connected' : ''}" data-id="${server.id}">
        <div class="mcp-server-header">
          <label class="toggle" style="margin-right: 8px;">
            <input type="checkbox" ${server.enabled ? 'checked' : ''} data-action="toggle" data-id="${server.id}">
            <span class="toggle-slider"></span>
          </label>
          <div class="mcp-server-info">
            <div class="mcp-server-name-row">
              <span class="mcp-server-name">${escapeHtml(server.name)}</span>
              ${statusBadge}
              ${toolCount > 0 ? `<span class="mcp-tool-count">${toolCount} tool${toolCount !== 1 ? 's' : ''}</span>` : ''}
            </div>
            <div class="mcp-server-command">${escapeHtml(server.command)} ${escapeHtml(server.args.join(' '))}</div>
          </div>
          <div class="mcp-server-actions">
            <button class="mcp-server-btn" data-action="edit" data-id="${server.id}" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="mcp-server-btn delete" data-action="delete" data-id="${server.id}" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        ${toolsList}
      </div>
    `;
  }).join('');
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showModal(isEdit = false) {
  if (modal) {
    modal.style.display = 'flex';
    if (modalTitle) {
      modalTitle.textContent = isEdit ? 'Edit MCP Server' : 'Add MCP Server';
    }
  }
}

function hideModal() {
  if (modal) {
    modal.style.display = 'none';
  }
  editingServerId = null;
  if (serverNameInput) serverNameInput.value = '';
  if (serverCommandInput) serverCommandInput.value = '';
  if (serverArgsInput) serverArgsInput.value = '';
}

async function saveServer() {
  const name = serverNameInput?.value.trim();
  const command = serverCommandInput?.value.trim();
  const argsStr = serverArgsInput?.value.trim();

  if (!name || !command) {
    return;
  }

  const args = argsStr ? argsStr.split(',').map(a => a.trim()).filter(Boolean) : [];

  if (editingServerId) {
    await claude.updateMCPServer(editingServerId, { name, command, args });
  } else {
    await claude.addMCPServer({ name, command, args, enabled: true });
  }

  await loadMCPServers();
  hideModal();
}

async function deleteServer(serverId: string) {
  await claude.removeMCPServer(serverId);
  await loadMCPServers();
}

async function toggleServer(serverId: string) {
  await claude.toggleMCPServer(serverId);
  await loadMCPServers();
}

function editServer(serverId: string) {
  const server = mcpServers.find(s => s.id === serverId);
  if (!server) return;

  editingServerId = serverId;
  if (serverNameInput) serverNameInput.value = server.name;
  if (serverCommandInput) serverCommandInput.value = server.command;
  if (serverArgsInput) serverArgsInput.value = server.args.join(', ');
  showModal(true);
}

// Event listeners for MCP servers
addServerBtn?.addEventListener('click', () => showModal());
closeModalBtn?.addEventListener('click', hideModal);
cancelModalBtn?.addEventListener('click', hideModal);
saveServerBtn?.addEventListener('click', saveServer);

modal?.addEventListener('click', (e) => {
  if (e.target === modal) hideModal();
});

serversList?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('[data-action]') as HTMLElement;
  if (!btn) return;

  const action = btn.dataset.action;
  const serverId = btn.dataset.id;
  if (!serverId) return;

  if (action === 'delete') deleteServer(serverId);
  else if (action === 'edit') editServer(serverId);
});

serversList?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.action === 'toggle' && target.dataset.id) {
    toggleServer(target.dataset.id);
  }
});

// Load settings on page load
window.addEventListener('load', () => {
  loadSettings();
  loadMCPServers();
  initializeKeybindInputs();
});
