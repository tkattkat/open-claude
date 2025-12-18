import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('claude', {
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  createConversation: (model?: string) => ipcRenderer.invoke('create-conversation', model),
  getConversations: () => ipcRenderer.invoke('get-conversations'),
  loadConversation: (convId: string) => ipcRenderer.invoke('load-conversation', convId),
  deleteConversation: (convId: string) => ipcRenderer.invoke('delete-conversation', convId),
  renameConversation: (convId: string, name: string) => ipcRenderer.invoke('rename-conversation', convId, name),
  starConversation: (convId: string, isStarred: boolean) => ipcRenderer.invoke('star-conversation', convId, isStarred),
  exportConversationMarkdown: (conversationData: { title: string; messages: Array<{ role: string; content: string; timestamp?: string }> }) =>
    ipcRenderer.invoke('export-conversation-markdown', conversationData),
  generateTitle: (convId: string, messageContent: string, recentTitles?: string[]) => ipcRenderer.invoke('generate-title', convId, messageContent, recentTitles || []),
  sendMessage: (conversationId: string, message: string, parentMessageUuid: string, attachments?: unknown[]) =>
    ipcRenderer.invoke('send-message', conversationId, message, parentMessageUuid, attachments || []),
  uploadAttachments: (files: Array<{ name: string; size: number; type: string; data: ArrayBuffer | Uint8Array | number[] }>) =>
    ipcRenderer.invoke('upload-attachments', files),
  stopResponse: (conversationId: string) => ipcRenderer.invoke('stop-response', conversationId),

  // Stream listeners
  onMessageStream: (callback: (data: { conversationId: string; text: string; fullText: string }) => void) => {
    ipcRenderer.on('message-stream', (_event, data) => callback(data));
  },
  onMessageComplete: (callback: (data: {
    conversationId: string;
    fullText: string;
    steps?: Array<{
      type: 'thinking' | 'tool';
      index: number;
      thinkingText?: string;
      toolName?: string;
      toolInput?: string;
      toolResult?: unknown;
      isError?: boolean;
    }>;
    messageUuid: string
  }) => void) => {
    ipcRenderer.on('message-complete', (_event, data) => callback(data));
  },
  onMessageThinking: (callback: (data: { conversationId: string; blockIndex: number; isThinking: boolean; thinkingText?: string }) => void) => {
    ipcRenderer.on('message-thinking', (_event, data) => callback(data));
  },
  onMessageThinkingStream: (callback: (data: { conversationId: string; blockIndex: number; thinking: string }) => void) => {
    ipcRenderer.on('message-thinking-stream', (_event, data) => callback(data));
  },
  onMessageToolUse: (callback: (data: { conversationId: string; blockIndex: number; toolName: string; message: string; input?: string; isRunning: boolean }) => void) => {
    ipcRenderer.on('message-tool-use', (_event, data) => callback(data));
  },
  onMessageToolResult: (callback: (data: { conversationId: string; blockIndex: number; toolName: string; result?: unknown; isError: boolean }) => void) => {
    ipcRenderer.on('message-tool-result', (_event, data) => callback(data));
  },
  // Citation events (for inline source citations)
  onMessageCitation: (callback: (data: { conversationId: string; blockIndex: number; citation: { uuid: string; start_index: number; end_index?: number; url?: string; title?: string } }) => void) => {
    ipcRenderer.on('message-citation', (_event, data) => callback(data));
  },
  // Tool approval events (for MCP tools requiring permission)
  onMessageToolApproval: (callback: (data: { conversationId: string; toolName: string; approvalKey: string; input?: unknown }) => void) => {
    ipcRenderer.on('message-tool-approval', (_event, data) => callback(data));
  },
  // Compaction status (conversation compaction)
  onMessageCompaction: (callback: (data: { conversationId: string; status: string; message?: string }) => void) => {
    ipcRenderer.on('message-compaction', (_event, data) => callback(data));
  },
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('message-stream');
    ipcRenderer.removeAllListeners('message-complete');
    ipcRenderer.removeAllListeners('message-thinking');
    ipcRenderer.removeAllListeners('message-thinking-stream');
    ipcRenderer.removeAllListeners('message-tool-use');
    ipcRenderer.removeAllListeners('message-tool-result');
    ipcRenderer.removeAllListeners('message-citation');
    ipcRenderer.removeAllListeners('message-tool-approval');
    ipcRenderer.removeAllListeners('message-compaction');
  },

  // Spotlight functions
  spotlightResize: (height: number) => ipcRenderer.invoke('spotlight-resize', height),
  spotlightSend: (message: string) => ipcRenderer.invoke('spotlight-send', message),
  onSpotlightStream: (callback: (data: { text: string; fullText: string }) => void) => {
    ipcRenderer.on('spotlight-stream', (_event, data) => callback(data));
  },
  onSpotlightComplete: (callback: (data: { fullText: string }) => void) => {
    ipcRenderer.on('spotlight-complete', (_event, data) => callback(data));
  },
  onSpotlightThinking: (callback: (data: { isThinking: boolean; thinkingText?: string }) => void) => {
    ipcRenderer.on('spotlight-thinking', (_event, data) => callback(data));
  },
  onSpotlightThinkingStream: (callback: (data: { thinking: string }) => void) => {
    ipcRenderer.on('spotlight-thinking-stream', (_event, data) => callback(data));
  },
  onSpotlightTool: (callback: (data: { toolName: string; isRunning: boolean; message?: string; input?: string }) => void) => {
    ipcRenderer.on('spotlight-tool', (_event, data) => callback(data));
  },
  onSpotlightToolResult: (callback: (data: { toolName: string; isError: boolean; result?: unknown }) => void) => {
    ipcRenderer.on('spotlight-tool-result', (_event, data) => callback(data));
  },
  removeSpotlightListeners: () => {
    ipcRenderer.removeAllListeners('spotlight-stream');
    ipcRenderer.removeAllListeners('spotlight-complete');
    ipcRenderer.removeAllListeners('spotlight-thinking');
    ipcRenderer.removeAllListeners('spotlight-thinking-stream');
    ipcRenderer.removeAllListeners('spotlight-tool');
    ipcRenderer.removeAllListeners('spotlight-tool-result');
  },
  spotlightReset: () => ipcRenderer.invoke('spotlight-reset'),
  spotlightGetHistory: () => ipcRenderer.invoke('spotlight-get-history'),
  spotlightNewChat: () => ipcRenderer.invoke('spotlight-new-chat'),
  spotlightSaveDraft: (draft: string) => ipcRenderer.invoke('spotlight-save-draft', draft),

  // Search modal toggle (triggered by global Command+K shortcut)
  onToggleSearchModal: (callback: () => void) => {
    ipcRenderer.on('toggle-search-modal', () => callback());
  },

  // Settings functions
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: { spotlightKeybind?: string; spotlightPersistHistory?: boolean; newWindowKeybind?: string }) =>
    ipcRenderer.invoke('save-settings', settings),

  // Window management
  newWindow: () => ipcRenderer.invoke('new-window'),
});
