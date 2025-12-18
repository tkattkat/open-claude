// Settings renderer

const claude = (window as any).claude;

interface Settings {
  spotlightKeybind: string;
  spotlightPersistHistory: boolean;
  newWindowKeybind: string;
}

// DOM Elements
const keybindInput = document.getElementById('keybind-input') as HTMLElement;
const keybindDisplay = document.getElementById('keybind-display') as HTMLElement;
const newWindowKeybindInput = document.getElementById('new-window-keybind-input') as HTMLElement;
const newWindowKeybindDisplay = document.getElementById('new-window-keybind-display') as HTMLElement;
const persistHistoryCheckbox = document.getElementById('persist-history') as HTMLInputElement;

let currentSettings: Settings | null = null;

// Keybind recording state
interface KeybindRecorder {
  input: HTMLElement;
  display: HTMLElement;
  settingKey: 'spotlightKeybind' | 'newWindowKeybind';
  isRecording: boolean;
  pendingKeybind: string | null;
}

const keybindRecorders: KeybindRecorder[] = [
  { input: keybindInput, display: keybindDisplay, settingKey: 'spotlightKeybind', isRecording: false, pendingKeybind: null },
  { input: newWindowKeybindInput, display: newWindowKeybindDisplay, settingKey: 'newWindowKeybind', isRecording: false, pendingKeybind: null },
];

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

// Build accelerator string from current modifier state
function buildAcceleratorFromModifiers(e: KeyboardEvent): string {
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

  return parts.join('+');
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

// Load settings
async function loadSettings() {
  currentSettings = await claude.getSettings();

  if (currentSettings) {
    keybindDisplay.textContent = formatKeybind(currentSettings.spotlightKeybind);
    newWindowKeybindDisplay.textContent = formatKeybind(currentSettings.newWindowKeybind);
    persistHistoryCheckbox.checked = currentSettings.spotlightPersistHistory;
  }
}

// Save keybind for a specific setting
async function saveKeybind(settingKey: 'spotlightKeybind' | 'newWindowKeybind', keybind: string) {
  if (!currentSettings) return;

  currentSettings = await claude.saveSettings({ [settingKey]: keybind });
}

// Save persist history
async function savePersistHistory(value: boolean) {
  if (!currentSettings) return;

  currentSettings = await claude.saveSettings({ spotlightPersistHistory: value });
}

// Stop recording and save if we have a valid keybind
function stopRecording(recorder: KeybindRecorder, save: boolean) {
  if (!recorder.isRecording) return;

  recorder.isRecording = false;
  recorder.input.classList.remove('recording');

  if (save && recorder.pendingKeybind) {
    saveKeybind(recorder.settingKey, recorder.pendingKeybind);
    recorder.display.textContent = formatKeybind(recorder.pendingKeybind);
  } else if (currentSettings) {
    recorder.display.textContent = formatKeybind(currentSettings[recorder.settingKey]);
  }

  recorder.pendingKeybind = null;
}

// Set up keybind recording for each recorder
keybindRecorders.forEach(recorder => {
  recorder.input.addEventListener('click', () => {
    if (!recorder.isRecording) {
      // Stop any other recorders
      keybindRecorders.forEach(r => {
        if (r !== recorder && r.isRecording) {
          stopRecording(r, false);
        }
      });

      recorder.isRecording = true;
      recorder.pendingKeybind = null;
      recorder.input.classList.add('recording');
      recorder.display.textContent = 'Press keys...';
      recorder.input.focus();
    }
  });

  recorder.input.addEventListener('keydown', (e) => {
    if (!recorder.isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    // Handle Escape to cancel
    if (e.key === 'Escape') {
      stopRecording(recorder, false);
      return;
    }

    // Handle Enter to confirm
    if (e.key === 'Enter' && recorder.pendingKeybind) {
      stopRecording(recorder, true);
      return;
    }

    const result = keyEventToAccelerator(e);

    // Update display to show current keys being pressed
    if (result.accelerator) {
      recorder.display.textContent = formatKeybind(result.accelerator);

      // If we have a complete combo (modifier + key), store it as pending
      if (result.isComplete) {
        recorder.pendingKeybind = result.accelerator;
      }
    }
  });

  recorder.input.addEventListener('blur', () => {
    // Save pending keybind on blur (clicking away)
    stopRecording(recorder, !!recorder.pendingKeybind);
  });
});

// Persist history toggle
persistHistoryCheckbox.addEventListener('change', () => {
  savePersistHistory(persistHistoryCheckbox.checked);
});

// Load settings on page load
window.addEventListener('load', loadSettings);
