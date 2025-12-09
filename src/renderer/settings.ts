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

// Load settings on page load
window.addEventListener('load', () => {
  loadSettings();
  initializeKeybindInputs();
});
