import { app, BrowserWindow, ipcMain, session, globalShortcut, screen, systemPreferences, desktopCapturer, shell,dialog } from 'electron';
//import { app, BrowserWindow, ipcMain, session, globalShortcut, screen, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Permission types
type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';

interface PermissionStatus {
  camera: MediaAccessStatus;
  microphone: MediaAccessStatus;
  screen: MediaAccessStatus;
  accessibility: boolean;
}

// Check all permissions
function getPermissionStatus(): PermissionStatus {
  if (process.platform !== 'darwin') {
    return {
      camera: 'granted',
      microphone: 'granted',
      screen: 'granted',
      accessibility: true
    };
  }

  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  };
}

// Request media access (camera/microphone)
async function requestMediaAccess(mediaType: 'camera' | 'microphone'): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  const status = systemPreferences.getMediaAccessStatus(mediaType);
  if (status === 'granted') return true;
  if (status === 'denied' || status === 'restricted') {
    // Open System Preferences
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_' +
      (mediaType === 'camera' ? 'Camera' : 'Microphone'));
    return false;
  }

  return await systemPreferences.askForMediaAccess(mediaType);
}

// Open System Preferences for permissions that can't be requested programmatically
function openPermissionSettings(permission: 'screen' | 'accessibility' | 'files'): void {
  if (process.platform !== 'darwin') return;

  const urls: Record<string, string> = {
    screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    files: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
  };

  shell.openExternal(urls[permission]);
}
import { isAuthenticated, getOrgId, makeRequest, streamCompletion, stopResponse, generateTitle, store, BASE_URL, prepareAttachmentPayload } from './api/client';
import { createStreamState, processSSEChunk, type StreamCallbacks } from './streaming/parser';
import type { SettingsSchema, AttachmentPayload, UploadFilePayload, MCPServerConfig } from './types';
import { mcpClient } from './mcp/client';

let mainWindows: BrowserWindow[] = [];
let spotlightWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// Helper to get the focused main window or first one
function getMainWindow(): BrowserWindow | null {
  const focused = mainWindows.find(w => w.isFocused());
  return focused || mainWindows[0] || null;
}
// Default keyboard shortcuts
const DEFAULT_KEYBOARD_SHORTCUTS = {
  spotlight: 'CommandOrControl+Shift+C',
  newConversation: 'CommandOrControl+N',
  toggleSidebar: 'CommandOrControl+B',
};

// Default settings
const DEFAULT_SETTINGS: SettingsSchema = {
  spotlightKeybind: 'CommandOrControl+Shift+C',
  spotlightPersistHistory: true,
  mcpServers: [],
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
};

// Sanitize a single arg by stripping surrounding quotes
function sanitizeArg(arg: string): string {
  if (typeof arg !== 'string') return '';
  // Strip surrounding single or double quotes
  if ((arg.startsWith('"') && arg.endsWith('"')) ||
      (arg.startsWith("'") && arg.endsWith("'"))) {
    return arg.slice(1, -1);
  }
  return arg;
}

// Sanitize and validate MCP server configs
function sanitizeMCPServers(servers: MCPServerConfig[]): MCPServerConfig[] {
  if (!Array.isArray(servers)) return [];

  return servers
    .filter(server => server && typeof server === 'object')
    .map(server => {
      // Ensure id exists (generate one if missing so it can be deleted)
      const id = (server.id && typeof server.id === 'string') ? server.id : crypto.randomUUID();
      // Keep name/command even if empty (so user can see and delete bad entries)
      const name = typeof server.name === 'string' ? server.name : '';
      const command = typeof server.command === 'string' ? sanitizeArg(server.command) : '';
      // Invalid if missing name or command
      const isValid = name.length > 0 && command.length > 0;

      return {
        ...server,
        id,
        name,
        command,
        // Sanitize args array
        args: Array.isArray(server.args)
          ? server.args.map(a => typeof a === 'string' ? sanitizeArg(a) : '').filter(a => a.length > 0)
          : [],
        // Auto-disable invalid configs
        enabled: isValid ? server.enabled === true : false,
        // Ensure env is object or empty
        env: (server.env && typeof server.env === 'object') ? server.env : {}
      };
    });
}

// Get settings with defaults
function getSettings(): SettingsSchema {
  const stored = store.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  // Sanitize MCP servers on load
  if (settings.mcpServers) {
    settings.mcpServers = sanitizeMCPServers(settings.mcpServers);
  }

  return settings;
}

// Save settings
function saveSettings(settings: Partial<SettingsSchema>) {
  const current = getSettings();
  const merged = { ...current, ...settings };

  // Sanitize MCP servers before saving
  if (merged.mcpServers) {
    merged.mcpServers = sanitizeMCPServers(merged.mcpServers);
  }

  store.set('settings', merged);
}

// Connect to all enabled MCP servers
async function connectMCPServers(): Promise<void> {
  const settings = getSettings();
  const servers = settings.mcpServers || [];

  // Disconnect all first
  await mcpClient.disconnectAll();

  // Connect to enabled servers
  for (const server of servers) {
    if (server.enabled) {
      try {
        await mcpClient.connect(server);
      } catch (error) {
        console.error(`[MCP] Failed to connect to ${server.name}:`, error);
      }
    }
  }
}

// Get all available MCP tools for Claude API
function getMCPToolsForAPI(): Array<{
  name: string;
  description: string;
  input_schema: { type: string; properties?: Record<string, unknown>; required?: string[] };
}> {
  return mcpClient.getToolsForClaude();
}

// Register all keyboard shortcuts
function registerKeyboardShortcuts() {
  globalShortcut.unregisterAll();
  const settings = getSettings();
  const shortcuts = settings.keyboardShortcuts || DEFAULT_KEYBOARD_SHORTCUTS;

  // Register spotlight shortcut
  const spotlightKey = shortcuts.spotlight || settings.spotlightKeybind || DEFAULT_KEYBOARD_SHORTCUTS.spotlight;
  try {
    globalShortcut.register(spotlightKey, () => {
      createSpotlightWindow();
    });
  } catch (e) {
    console.error('Failed to register spotlight keybind:', spotlightKey, e);
    globalShortcut.register(DEFAULT_KEYBOARD_SHORTCUTS.spotlight, () => {
      createSpotlightWindow();
    });
  }

  // Register new conversation shortcut
  const newConvKey = shortcuts.newConversation || DEFAULT_KEYBOARD_SHORTCUTS.newConversation;
  try {
    globalShortcut.register(newConvKey, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-conversation');
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    console.error('Failed to register new conversation keybind:', newConvKey, e);
  }

  // Register toggle sidebar shortcut
  const sidebarKey = shortcuts.toggleSidebar || DEFAULT_KEYBOARD_SHORTCUTS.toggleSidebar;
  try {
    globalShortcut.register(sidebarKey, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toggle-sidebar');
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (e) {
    console.error('Failed to register toggle sidebar keybind:', sidebarKey, e);
  }
}

// Legacy function for compatibility
function registerSpotlightShortcut() {
  registerKeyboardShortcuts();
}

// Create spotlight search window
function createSpotlightWindow() {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    spotlightWindow.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const isMac = process.platform === 'darwin';

  spotlightWindow = new BrowserWindow({
    width: 600,
    height: 56,
    x: Math.round((screenWidth - 600) / 2),
    y: 180,
    frame: false,
    transparent: isMac,
    ...(isMac ? {
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    } : {
      backgroundColor: '#1a1a1a',
    }),
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  spotlightWindow.loadFile(path.join(__dirname, '../static/spotlight.html'));

  // Close on blur (clicking outside)
  spotlightWindow.on('blur', () => {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      spotlightWindow.close();
    }
  });

  spotlightWindow.on('closed', () => {
    spotlightWindow = null;
  });
}

function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    ...(isMac ? {
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    } : {
      backgroundColor: '#1a1a1a',
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '../static/index.html'));

  // Track window
  mainWindows.push(win);

  // Remove from array when closed
  win.on('closed', () => {
    const index = mainWindows.indexOf(win);
    if (index > -1) {
      mainWindows.splice(index, 1);
    }
  });

  return win;
}

// Create settings window
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const isMac = process.platform === 'darwin';

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    minWidth: 400,
    minHeight: 400,
    ...(isMac ? {
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    } : {
      backgroundColor: '#1a1a1a',
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '../static/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// IPC handlers

// Spotlight window resize
ipcMain.handle('spotlight-resize', async (_event, height: number) => {
  if (spotlightWindow && !spotlightWindow.isDestroyed()) {
    const maxHeight = 700;
    const newHeight = Math.min(height, maxHeight);
    spotlightWindow.setSize(600, newHeight);
  }
});

// Spotlight conversation state
let spotlightConversationId: string | null = null;
let spotlightParentMessageUuid: string | null = null;
let spotlightMessages: Array<{ role: 'user' | 'assistant'; text: string }> = [];

// Spotlight send message (uses Haiku)
ipcMain.handle('spotlight-send', async (_event, message: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  if (!spotlightConversationId) {
    const createResult = await makeRequest(
      `${BASE_URL}/api/organizations/${orgId}/chat_conversations`,
      'POST',
      { name: '', model: 'claude-haiku-4-5-20251001' }
    );

    if (createResult.status !== 201 && createResult.status !== 200) {
      throw new Error('Failed to create conversation');
    }

    const convData = createResult.data as { uuid: string };
    spotlightConversationId = convData.uuid;
    spotlightParentMessageUuid = null;
  }

  const conversationId = spotlightConversationId;
  const parentMessageUuid = spotlightParentMessageUuid || conversationId;

  // Store user message
  spotlightMessages.push({ role: 'user', text: message });

  const state = createStreamState();

  const callbacks: StreamCallbacks = {
    onTextDelta: (text, fullText) => {
      spotlightWindow?.webContents.send('spotlight-stream', { text, fullText });
    },
    onThinkingStart: () => {
      spotlightWindow?.webContents.send('spotlight-thinking', { isThinking: true });
    },
    onThinkingDelta: (thinking) => {
      spotlightWindow?.webContents.send('spotlight-thinking-stream', { thinking });
    },
    onThinkingStop: (thinkingText) => {
      spotlightWindow?.webContents.send('spotlight-thinking', { isThinking: false, thinkingText });
    },
    onToolStart: (toolName, msg) => {
      spotlightWindow?.webContents.send('spotlight-tool', { toolName, isRunning: true, message: msg });
    },
    onToolStop: (toolName, input) => {
      spotlightWindow?.webContents.send('spotlight-tool', { toolName, isRunning: false, input });
    },
    onToolResult: (toolName, result, isError) => {
      spotlightWindow?.webContents.send('spotlight-tool-result', { toolName, isError, result });
    },
    onComplete: (fullText, _steps, messageUuid) => {
      // Store assistant response
      spotlightMessages.push({ role: 'assistant', text: fullText });
      spotlightWindow?.webContents.send('spotlight-complete', { fullText, messageUuid });
    }
  };

  await streamCompletion(orgId, conversationId, message, parentMessageUuid, (chunk) => {
    processSSEChunk(chunk, state, callbacks);
  });

  if (state.lastMessageUuid) {
    spotlightParentMessageUuid = state.lastMessageUuid;
  }

  return { conversationId, fullText: state.fullResponse, messageUuid: state.lastMessageUuid };
});

// Reset spotlight conversation when window is closed
ipcMain.handle('spotlight-reset', async () => {
  const settings = getSettings();
  // Only reset if persist history is disabled
  if (!settings.spotlightPersistHistory) {
    spotlightConversationId = null;
    spotlightParentMessageUuid = null;
    spotlightMessages = [];
  }
});

// Get spotlight conversation history from local state
ipcMain.handle('spotlight-get-history', async () => {
  const settings = getSettings();
  if (!settings.spotlightPersistHistory || spotlightMessages.length === 0) {
    return { hasHistory: false, messages: [] };
  }

  return { hasHistory: true, messages: spotlightMessages };
});

// Force new spotlight conversation
ipcMain.handle('spotlight-new-chat', async () => {
  spotlightConversationId = null;
  spotlightParentMessageUuid = null;
  spotlightMessages = [];
});

ipcMain.handle('get-auth-status', async () => {
  return isAuthenticated();
});

ipcMain.handle('login', async () => {
  const authWindow = new BrowserWindow({
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Sign in to Claude',
  });

  authWindow.loadURL(`${BASE_URL}/login`);

  const checkCookies = async (): Promise<{ success: boolean; error?: string } | null> => {
    const cookies = await session.defaultSession.cookies.get({ domain: '.claude.ai' });
    const sessionKey = cookies.find(c => c.name === 'sessionKey')?.value;
    const orgId = cookies.find(c => c.name === 'lastActiveOrg')?.value;

    if (sessionKey && orgId) {
      console.log('[Auth] Got cookies from webview!');
      authWindow.close();
      store.set('orgId', orgId);
      return { success: true };
    }
    return null;
  };

  return new Promise((resolve) => {
    authWindow.webContents.on('did-finish-load', async () => {
      const result = await checkCookies();
      if (result) resolve(result);
    });

    const interval = setInterval(async () => {
      if (authWindow.isDestroyed()) {
        clearInterval(interval);
        return;
      }
      const result = await checkCookies();
      if (result) {
        clearInterval(interval);
        resolve(result);
      }
    }, 1000);

    authWindow.on('closed', () => {
      clearInterval(interval);
      resolve({ success: false, error: 'Window closed' });
    });
  });
});

ipcMain.handle('logout', async () => {
  store.clear();
  await session.defaultSession.clearStorageData({ storages: ['cookies'] });
  return { success: true };
});

// Create a new conversation
ipcMain.handle('create-conversation', async (_event, model?: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const conversationId = crypto.randomUUID();
  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations`;

  console.log('[API] Creating conversation:', conversationId, 'with model:', model || 'claude-opus-4-5-20251101');
  console.log('[API] URL:', url);

  const result = await makeRequest(url, 'POST', {
    uuid: conversationId,
    name: '',
    model: model || 'claude-opus-4-5-20251101',
    project_uuid: null,
    create_mode: null
  });

  console.log('[API] Create conversation response:', result.status, JSON.stringify(result.data));

  if (result.status !== 200 && result.status !== 201) {
    throw new Error(`Failed to create conversation: ${result.status} - ${JSON.stringify(result.data)}`);
  }

  // The response includes the conversation data with uuid
  const data = result.data as { uuid?: string };
  return { conversationId, parentMessageUuid: data.uuid || conversationId, ...(result.data as object) };
});

// Get list of conversations
ipcMain.handle('get-conversations', async () => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations?limit=30&consistency=eventual`;
  const result = await makeRequest(url, 'GET');

  if (result.status !== 200) {
    throw new Error(`Failed to get conversations: ${result.status}`);
  }

  return result.data;
});

// Load a specific conversation with messages
ipcMain.handle('load-conversation', async (_event, convId: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${convId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=eventual`;
  const result = await makeRequest(url, 'GET');

  if (result.status !== 200) {
    throw new Error(`Failed to load conversation: ${result.status}`);
  }

  return result.data;
});

// Delete a conversation
ipcMain.handle('delete-conversation', async (_event, convId: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${convId}`;
  const result = await makeRequest(url, 'DELETE');

  if (result.status !== 200 && result.status !== 204) {
    throw new Error(`Failed to delete conversation: ${result.status}`);
  }

  return { success: true };
});

// Rename a conversation
ipcMain.handle('rename-conversation', async (_event, convId: string, name: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${convId}`;
  const result = await makeRequest(url, 'PUT', { name });

  if (result.status !== 200) {
    throw new Error(`Failed to rename conversation: ${result.status}`);
  }

  return result.data;
});

// Star/unstar a conversation
ipcMain.handle('star-conversation', async (_event, convId: string, isStarred: boolean) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${convId}?rendering_mode=raw`;
  const result = await makeRequest(url, 'PUT', { is_starred: isStarred });

  if (result.status !== 202) {
    throw new Error(`Failed to star conversation: ${result.status}`);
  }

  return result.data;
});

// Export conversation to Markdown
ipcMain.handle('export-conversation-markdown', async (_event, conversationData: { title: string; messages: Array<{ role: string; content: string; timestamp?: string }> }) => {
  const { title, messages } = conversationData;

  // Build markdown content
  let markdown = `# ${title || 'Conversation'}\n\n`;
  markdown += `_Exported on ${new Date().toLocaleString()}_\n\n---\n\n`;

  for (const msg of messages) {
    const role = msg.role === 'human' ? 'You' : 'Claude';
    const timestamp = msg.timestamp ? ` _(${new Date(msg.timestamp).toLocaleString()})_` : '';
    markdown += `## ${role}${timestamp}\n\n`;
    markdown += `${msg.content}\n\n---\n\n`;
  }

  // Show save dialog
  const result = await dialog.showSaveDialog(getMainWindow()!, {
    title: 'Export Conversation',
    defaultPath: `${title || 'conversation'}.md`,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  // Write file
  try {
    fs.writeFileSync(result.filePath, markdown, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (error) {
    console.error('Failed to write file:', error);
    return { success: false, error: 'Failed to write file' };
  }
});

// Upload file attachments (prepare metadata only)
ipcMain.handle('upload-attachments', async (_event, files: UploadFilePayload[]) => {
  const uploads: AttachmentPayload[] = [];
  for (const file of files || []) {
    const attachment = await prepareAttachmentPayload(file);
    uploads.push(attachment);
  }

  return uploads;
});

// Send a message and stream response
interface MCPToolSelection {
  serverId: string;
  toolName: string;
}

ipcMain.handle('send-message', async (event, conversationId: string, message: string, parentMessageUuid: string, attachments: AttachmentPayload[] = [], mcpTools: MCPToolSelection[] = []) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  console.log('[API] Sending message to conversation:', conversationId);
  console.log('[API] Parent message UUID:', parentMessageUuid);
  console.log('[API] Message:', message.substring(0, 50) + '...');
  if (attachments?.length) {
    console.log('[API] Attachments:', attachments.map(a => `${a.file_name} (${a.file_size})`).join(', '));
    console.log('[API] File IDs:', attachments.map(a => a.document_id).join(', '));
  }
  if (mcpTools?.length) {
    console.log('[API] Selected MCP tools:', mcpTools.map(t => `${t.serverId}:${t.toolName}`).join(', '));
  }

  const state = createStreamState();
  const sender = event.sender;

  const callbacks: StreamCallbacks = {
    onTextDelta: (text, fullText, blockIndex) => {
      sender.send('message-stream', { conversationId, blockIndex, text, fullText });
    },
    onThinkingStart: (blockIndex) => {
      sender.send('message-thinking', { conversationId, blockIndex, isThinking: true });
    },
    onThinkingDelta: (thinking, blockIndex) => {
      const block = state.contentBlocks.get(blockIndex);
      sender.send('message-thinking-stream', {
        conversationId,
        blockIndex,
        thinking,
        summaries: block?.summaries
      });
    },
    onThinkingStop: (thinkingText, summaries, blockIndex) => {
      sender.send('message-thinking', {
        conversationId,
        blockIndex,
        isThinking: false,
        thinkingText,
        summaries
      });
    },
    onToolStart: (toolName, toolMessage, blockIndex) => {
      sender.send('message-tool-use', {
        conversationId,
        blockIndex,
        toolName,
        message: toolMessage,
        isRunning: true
      });
    },
    onToolStop: (toolName, input, blockIndex) => {
      const block = state.contentBlocks.get(blockIndex);
      sender.send('message-tool-use', {
        conversationId,
        blockIndex,
        toolName,
        message: block?.toolMessage,
        input,
        isRunning: false
      });
    },
    onToolResult: (toolName, result, isError, blockIndex) => {
      sender.send('message-tool-result', {
        conversationId,
        blockIndex,
        toolName,
        result,
        isError
      });
    },
    onCitation: (citation, blockIndex) => {
      sender.send('message-citation', { conversationId, blockIndex, citation });
    },
    onToolApproval: (toolName, approvalKey, input) => {
      sender.send('message-tool-approval', { conversationId, toolName, approvalKey, input });
    },
    onCompaction: (status, compactionMessage) => {
      sender.send('message-compaction', { conversationId, status, message: compactionMessage });
    },
    onComplete: (fullText, steps, messageUuid) => {
      sender.send('message-complete', { conversationId, fullText, steps, messageUuid });
    }
  };

  // Send Claude the uploaded file UUIDs (metadata stays client-side for display)
  const fileIds = attachments?.map(a => a.document_id).filter(Boolean) || [];

  await streamCompletion(orgId, conversationId, message, parentMessageUuid, (chunk) => {
    processSSEChunk(chunk, state, callbacks);
  }, { attachments: [], files: fileIds });

  return { text: state.fullResponse, messageUuid: state.lastMessageUuid };
});

// Stop a streaming response
ipcMain.handle('stop-response', async (_event, conversationId: string) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  console.log('[API] Stopping response for conversation:', conversationId);
  await stopResponse(orgId, conversationId);
  return { success: true };
});

// Generate title for a conversation
ipcMain.handle('generate-title', async (_event, conversationId: string, messageContent: string, recentTitles: string[] = []) => {
  const orgId = await getOrgId();
  if (!orgId) throw new Error('Not authenticated');

  console.log('[API] Generating title for conversation:', conversationId);
  const result = await generateTitle(orgId, conversationId, messageContent, recentTitles);
  return result;
});

// Settings IPC handlers
ipcMain.handle('open-settings', async () => {
  createSettingsWindow();
});

ipcMain.handle('get-settings', async () => {
  return getSettings();
});

ipcMain.handle('save-settings', async (_event, settings: Partial<SettingsSchema>) => {
  saveSettings(settings);
  // Re-register shortcut if keybind changed
  if (settings.spotlightKeybind !== undefined) {
    registerSpotlightShortcut();
  }
  return getSettings();
});

// Window management
ipcMain.handle('new-window', async () => {
  const win = createMainWindow();
  return { windowId: win.id };
});

ipcMain.handle('detach-tab', async (_event, tabData: { conversationId: string | null; title: string }) => {
  // Create a new window and send it the tab data
  const win = createMainWindow();

  // Wait for the window to load, then send the tab data
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('receive-tab', tabData);
  });

  return { windowId: win.id };
});

ipcMain.handle('get-window-count', async () => {
  return mainWindows.length;
});

// MCP Server management
ipcMain.handle('get-mcp-servers', async () => {
  const settings = getSettings();
  return settings.mcpServers || [];
});

ipcMain.handle('add-mcp-server', async (_event, server: MCPServerConfig) => {
  const settings = getSettings();
  const mcpServers = [...(settings.mcpServers || []), { ...server, id: crypto.randomUUID() }];
  saveSettings({ mcpServers });
  // Reconnect MCP servers to pick up new server
  await connectMCPServers();
  return getSettings().mcpServers;
});

ipcMain.handle('update-mcp-server', async (_event, serverId: string, updates: Partial<MCPServerConfig>) => {
  const settings = getSettings();
  const mcpServers = (settings.mcpServers || []).map(s =>
    s.id === serverId ? { ...s, ...updates } : s
  );
  saveSettings({ mcpServers });
  // Reconnect MCP servers to apply updates
  await connectMCPServers();
  return getSettings().mcpServers;
});

ipcMain.handle('remove-mcp-server', async (_event, serverId: string) => {
  const settings = getSettings();
  const mcpServers = (settings.mcpServers || []).filter(s => s.id !== serverId);
  saveSettings({ mcpServers });
  // Reconnect MCP servers (will disconnect removed server)
  await connectMCPServers();
  return getSettings().mcpServers;
});

ipcMain.handle('toggle-mcp-server', async (_event, serverId: string) => {
  const settings = getSettings();
  const mcpServers = (settings.mcpServers || []).map(s =>
    s.id === serverId ? { ...s, enabled: !s.enabled } : s
  );
  saveSettings({ mcpServers });
  // Reconnect MCP servers to apply toggle
  await connectMCPServers();
  return getSettings().mcpServers;
});

// Get available MCP tools
ipcMain.handle('get-mcp-tools', async () => {
  return getMCPToolsForAPI();
});

// Get MCP server status (connection status and tools)
ipcMain.handle('get-mcp-server-status', async () => {
  const settings = getSettings();
  const servers = settings.mcpServers || [];
  const connections = mcpClient.getAllConnections();

  return servers.map(server => {
    const connection = connections.find(c => c.config.id === server.id);
    return {
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      isConnected: connection?.isConnected || false,
      tools: connection?.tools || [],
      error: connection ? null : (server.enabled ? 'Not connected' : null)
    };
  });
});

// Execute MCP tool
ipcMain.handle('execute-mcp-tool', async (_event, toolName: string, args: Record<string, unknown>) => {
  // Parse the tool name to find the server (format: mcp_serverName_toolName)
  const parts = toolName.split('_');
  if (parts.length < 3 || parts[0] !== 'mcp') {
    throw new Error(`Invalid MCP tool name: ${toolName}`);
  }

  const serverName = parts[1];
  const actualToolName = parts.slice(2).join('_');

  // Find the server connection by name
  const connections = mcpClient.getAllConnections();
  const connection = connections.find(c => c.config.name === serverName);

  if (!connection || !connection.isConnected) {
    throw new Error(`MCP server ${serverName} is not connected`);
  }

  return await mcpClient.callTool(connection.config.id, actualToolName, args);
});

// Permission management
ipcMain.handle('get-permission-status', async () => {
  return getPermissionStatus();
});

ipcMain.handle('request-media-access', async (_event, mediaType: 'camera' | 'microphone') => {
  return await requestMediaAccess(mediaType);
});

ipcMain.handle('open-permission-settings', async (_event, permission: 'screen' | 'accessibility' | 'files') => {
  openPermissionSettings(permission);
  return { success: true };
});

// Request screen capture access (via desktopCapturer)
ipcMain.handle('request-screen-capture', async () => {
  if (process.platform !== 'darwin') return { granted: true, sources: [] };

  try {
    // Attempting to get sources will prompt for permission on macOS
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    return {
      granted: sources.length > 0,
      sources: sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
    };
  } catch (error) {
    console.error('[Permissions] Screen capture error:', error);
    return { granted: false, sources: [], error: String(error) };
  }
});

// Check if running on macOS
ipcMain.handle('get-platform', async () => {
  return process.platform;
});

// Handle deep link on Windows (single instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(async () => {
  createMainWindow();

  // Register spotlight shortcut from settings
  registerSpotlightShortcut();

  // Connect to MCP servers
  await connectMCPServers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Unregister shortcuts and disconnect MCP when app quits
app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  await mcpClient.disconnectAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
