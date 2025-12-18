import { parseMarkdown } from './markdown.js';


declare global {
  interface Window {
    claude: {
      getAuthStatus: () => Promise<boolean>;
      login: () => Promise<{ success: boolean; error?: string }>;
      logout: () => Promise<void>;
      createConversation: (model?: string) => Promise<{ conversationId: string; parentMessageUuid: string; uuid?: string }>;
      getConversations: () => Promise<Conversation[]>;
      loadConversation: (convId: string) => Promise<ConversationData>;
      deleteConversation: (convId: string) => Promise<void>;
      renameConversation: (convId: string, name: string) => Promise<void>;
      starConversation: (convId: string, isStarred: boolean) => Promise<void>;
      exportConversationMarkdown: (conversationData: { title: string; messages: Array<{ role: string; content: string; timestamp?: string }> }) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
      sendMessage: (convId: string, message: string, parentUuid: string, attachments?: AttachmentPayload[]) => Promise<void>;
      stopResponse: (convId: string) => Promise<void>;
      generateTitle: (convId: string, messageContent: string) => Promise<void>;
      uploadAttachments: (files: Array<{ name: string; size: number; type: string; data: ArrayBuffer | Uint8Array | number[] }>) => Promise<UploadedAttachmentPayload[]>;
      openSettings: () => Promise<void>;
      getSettings: () => Promise<{ spotlightKeybind?: string; spotlightPersistHistory?: boolean }>;
      saveSettings: (settings: { spotlightKeybind?: string; spotlightPersistHistory?: boolean }) => Promise<{ spotlightKeybind?: string; spotlightPersistHistory?: boolean }>;
      newWindow: () => Promise<{ windowId: number }>;
      onMessageThinking: (callback: (data: ThinkingData) => void) => void;
      onMessageThinkingStream: (callback: (data: ThinkingStreamData) => void) => void;
      onMessageToolUse: (callback: (data: ToolUseData) => void) => void;
      onMessageToolResult: (callback: (data: ToolResultData) => void) => void;
      onMessageStream: (callback: (data: StreamData) => void) => void;
      onMessageComplete: (callback: (data: CompleteData) => void) => void;
    };
  }
}

interface Conversation {
  uuid: string;
  name?: string;
  summary?: string;
  is_starred?: boolean;
  updated_at: string;
}

interface ConversationData {
  name?: string;
  chat_messages?: Message[];
}

interface FileAsset {
  url: string;
  file_variant?: string;
  primary_color?: string;
  image_width?: number;
  image_height?: number;
}

interface MessageFile {
  file_kind: string;
  file_uuid: string;
  file_name: string;
  created_at?: string;
  thumbnail_url?: string;
  preview_url?: string;
  thumbnail_asset?: FileAsset;
  preview_asset?: FileAsset;
}

interface Message {
  uuid?: string;
  sender: string;
  content?: ContentBlock[];
  text?: string;
  created_at?: string;
  files?: MessageFile[];
  files_v2?: MessageFile[];
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  summaries?: { summary: string }[];
  name?: string;
  message?: string;
  display_content?: { text?: string };
  input?: unknown;
  content?: unknown[];
  is_error?: boolean;
  citations?: Citation[];
}

interface Citation {
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface AttachmentPayload {
  document_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_url?: string;
  extracted_content?: string;
}

interface UploadedAttachmentPayload extends AttachmentPayload {}

interface UploadedAttachment extends AttachmentPayload {
  id: string;
  previewUrl?: string;
}

interface ThinkingData {
  conversationId: string;
  blockIndex: number;
  isThinking: boolean;
  thinkingText?: string;
}

interface ThinkingStreamData {
  conversationId: string;
  blockIndex: number;
  thinking: string;
  summary?: string;
}

interface ToolUseData {
  conversationId: string;
  blockIndex: number;
  toolName: string;
  message?: string;
  input?: unknown;
  isRunning: boolean;
}

interface ToolResultData {
  conversationId: string;
  blockIndex: number;
  toolName: string;
  result: unknown;
  isError: boolean;
}

interface StreamData {
  conversationId: string;
  blockIndex?: number;
  fullText: string;
}

interface CompleteData {
  conversationId: string;
  fullText: string;
  steps: Step[];
  messageUuid: string;
}

interface Step {
  type: string;
  text?: string;
  thinkingText?: string;
  thinkingSummary?: string;
  summary?: string;
  toolName?: string;
  toolMessage?: string;
  message?: string;
  toolResult?: unknown;
  toolInput?: unknown;
  isError?: boolean;
  isActive?: boolean;
  index?: number;
  citations?: Citation[];
}

interface StreamingBlock {
  text?: string;
  summary?: string;
  isActive?: boolean;
  name?: string;
  message?: string;
  input?: unknown;
  result?: unknown;
  isRunning?: boolean;
  isError?: boolean;
}


let conversationId: string | null = null;
let parentMessageUuid: string | null = null;
let isLoading = false;
let currentStreamingElement: HTMLElement | null = null;
let streamingMessageUuid: string | null = null;
let conversations: Conversation[] = [];
let selectedModel = 'claude-opus-4-5-20251101';
let openDropdownId: string | null = null;
let pendingAttachments: UploadedAttachment[] = [];
let uploadingAttachments = false;
let attachmentError = '';
let currentConversationTitle = '';
let currentConversationMessages: Array<{ role: string; content: string; timestamp?: string }> = [];

const modelDisplayNames: Record<string, string> = {
  'claude-opus-4-5-20251101': 'Opus 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5'
};

const streamingBlocks = {
  thinkingBlocks: new Map<number, StreamingBlock>(),
  toolBlocks: new Map<number, StreamingBlock>(),
  textBlocks: new Map<number, StreamingBlock>(),
  textContent: ''
};

function resetStreamingBlocks() {
  streamingBlocks.thinkingBlocks.clear();
  streamingBlocks.toolBlocks.clear();
  streamingBlocks.textBlocks.clear();
  streamingBlocks.textContent = '';
}

const $ = (id: string) => document.getElementById(id);
const $$ = (selector: string) => document.querySelectorAll(selector);

function escapeHtml(text: string): string {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatFileSize(bytes: number): string {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function removeAttachment(id: string) {
  pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  renderAttachmentList();
}

const imageIconSvg = `<svg class="attachment-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const fileIconSvg = `<svg class="attachment-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

function renderAttachmentList() {
  const containers = [
    { list: $('attachment-list'), status: $('attachment-status') },
    { list: $('home-attachment-list'), status: $('home-attachment-status') }
  ];

  const pills = pendingAttachments.map(a => {
    const icon = a.file_type?.startsWith('image/') ? imageIconSvg : fileIconSvg;
    return `
      <div class="attachment-pill" data-id="${a.id}">
        <div class="attachment-icon">${icon}</div>
        <div class="attachment-meta">
          <div class="attachment-name">${escapeHtml(a.file_name)}</div>
          <div class="attachment-size">${formatFileSize(a.file_size)}</div>
        </div>
        <button class="attachment-remove" data-id="${a.id}" title="Remove">✕</button>
      </div>
    `;
  }).join('');

  containers.forEach(({ list, status }) => {
    if (!list) return;
    const hasContent = pendingAttachments.length > 0 || uploadingAttachments || !!attachmentError;
    list.parentElement?.classList.toggle('visible', hasContent);
    list.innerHTML = pills;

    list.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id;
        if (id) removeAttachment(id);
      });
    });

    if (status) {
      status.textContent = uploadingAttachments ? 'Uploading attachments…' : attachmentError;
      status.style.display = (uploadingAttachments || attachmentError) ? 'block' : 'none';
      status.classList.toggle('error', !!attachmentError);
    }
  });
}

function clearAttachments() {
  pendingAttachments = [];
  attachmentError = '';
  uploadingAttachments = false;
  renderAttachmentList();
}

function getAttachmentPayloads(): AttachmentPayload[] {
  return pendingAttachments.map(a => ({
    document_id: a.document_id,
    file_name: a.file_name,
    file_size: a.file_size,
    file_type: a.file_type,
    file_url: a.file_url,
    extracted_content: a.extracted_content
  }));
}

async function handleFileSelection(fileList: FileList | null) {
  if (!fileList || fileList.length === 0) return;

  attachmentError = '';
  uploadingAttachments = true;
  renderAttachmentList();

  try {
    const uploadPayload = await Promise.all(Array.from(fileList).map(async (file) => ({
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      data: await file.arrayBuffer()
    })));

    const results = await window.claude.uploadAttachments(uploadPayload);
    const normalized = results.map(res => ({
      id: crypto.randomUUID(),
      document_id: res.document_id,
      file_name: res.file_name,
      file_size: res.file_size,
      file_type: res.file_type,
      file_url: res.file_url,
      extracted_content: res.extracted_content
    }));

    pendingAttachments = [...pendingAttachments, ...normalized];
  } catch (e: any) {
    attachmentError = e?.message || 'Failed to upload attachments';
  } finally {
    uploadingAttachments = false;
    renderAttachmentList();
  }
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function autoResizeHome(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
}

function scrollToBottom() {
  const m = $('messages');
  if (m) m.scrollTop = m.scrollHeight;
}

function hideEmptyState() {
  const e = $('empty-state');
  if (e) e.style.display = 'none';
}

function showLogin() {
  const login = $('login');
  const home = $('home');
  const chat = $('chat');
  const sidebarTab = $('sidebar-tab');

  if (login) login.style.display = 'flex';
  if (home) home.classList.remove('active');
  if (chat) chat.classList.remove('active');
  if (sidebarTab) sidebarTab.classList.add('hidden');
  closeSidebar();
}

function showHome() {
  const login = $('login');
  const home = $('home');
  const chat = $('chat');
  const sidebarTab = $('sidebar-tab');
  const homeInput = $('home-input') as HTMLTextAreaElement;

  if (login) login.style.display = 'none';
  if (home) home.classList.add('active');
  if (chat) chat.classList.remove('active');
  if (sidebarTab) sidebarTab.classList.remove('hidden');
  if (homeInput) setTimeout(() => homeInput.focus(), 100);
}

function showChat() {
  const login = $('login');
  const home = $('home');
  const chat = $('chat');
  const sidebarTab = $('sidebar-tab');
  const modelBadge = document.querySelector('.model-badge');

  if (login) login.style.display = 'none';
  if (home) home.classList.remove('active');
  if (chat) chat.classList.add('active');
  if (sidebarTab) sidebarTab.classList.remove('hidden');
  if (modelBadge) modelBadge.textContent = modelDisplayNames[selectedModel] || 'Opus 4.5';
}

// Sidebar functions
function toggleSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const sidebarTab = $('sidebar-tab');

  if (!sidebar || !overlay || !sidebarTab) return;

  const isOpening = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');

  if (isOpening) {
    sidebarTab.classList.add('hidden');
    loadConversationsList();
  } else {
    sidebarTab.classList.remove('hidden');
  }
}

function closeSidebar() {
  const sidebar = $('sidebar');
  const overlay = $('sidebar-overlay');
  const sidebarTab = $('sidebar-tab');

  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  if (sidebarTab) sidebarTab.classList.remove('hidden');
}

// Model selection
function selectModel(btn: HTMLElement) {
  $$('.model-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedModel = btn.getAttribute('data-model') || selectedModel;
}

// Conversations list
async function loadConversationsList() {
  const content = $('sidebar-content');
  if (!content) return;

  try {
    conversations = await window.claude.getConversations();
    renderConversationsList();
  } catch (e) {
    content.innerHTML = '<div class="conv-loading">Failed to load</div>';
  }
}

function renderConversationItem(c: Conversation): string {
  return `
    <div class="conv-item ${c.uuid === conversationId ? 'active' : ''}" data-uuid="${c.uuid}" data-starred="${c.is_starred || false}">
      <div class="conv-item-row">
        <div class="conv-item-info" data-action="load" data-uuid="${c.uuid}">
          <div class="conv-item-title">${escapeHtml(c.name || c.summary || 'New conversation')}</div>
          <div class="conv-item-date">${formatDate(c.updated_at)}</div>
        </div>
        <button class="conv-menu-btn" data-action="menu" data-uuid="${c.uuid}">⋯</button>
      </div>
      <div class="conv-dropdown" id="conv-dropdown-${c.uuid}">
        <div class="conv-dropdown-item" data-action="star" data-uuid="${c.uuid}" data-starred="${!c.is_starred}">
          <span class="conv-dropdown-icon">${c.is_starred ? '☆' : '★'}</span>
          <span>${c.is_starred ? 'Unstar' : 'Star'}</span>
        </div>
        <div class="conv-dropdown-item" data-action="rename" data-uuid="${c.uuid}">
          <span class="conv-dropdown-icon">✎</span>
          <span>Rename</span>
        </div>
        <div class="conv-dropdown-item delete" data-action="delete" data-uuid="${c.uuid}">
          <span class="conv-dropdown-icon">✕</span>
          <span>Delete</span>
        </div>
      </div>
    </div>
  `;
}

function renderConversationsList() {
  const content = $('sidebar-content');
  if (!content) return;

  if (!conversations || conversations.length === 0) {
    content.innerHTML = '<div class="conv-loading">No conversations yet</div>';
    return;
  }

  const starred = conversations.filter(c => c.is_starred);
  const unstarred = conversations.filter(c => !c.is_starred);

  let html = '';

  if (starred.length > 0) {
    html += '<div class="conv-section-header">Favorites</div>';
    html += starred.map(renderConversationItem).join('');
  }

  if (unstarred.length > 0) {
    if (starred.length > 0) {
      html += '<div class="conv-section-header">Recent</div>';
    }
    html += unstarred.map(renderConversationItem).join('');
  }

  content.innerHTML = html;

  // Add event listeners
  content.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', handleConversationAction);
  });
}

function handleConversationAction(e: Event) {
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  const action = target.dataset.action;
  const uuid = target.dataset.uuid;

  if (!uuid) return;

  switch (action) {
    case 'load':
      loadConversation(uuid);
      break;
    case 'menu':
      toggleConvMenu(uuid);
      break;
    case 'star':
      starConversation(uuid, target.dataset.starred === 'true');
      break;
    case 'rename':
      startRenameConversation(uuid);
      break;
    case 'delete':
      deleteConversation(uuid);
      break;
  }
}

function toggleConvMenu(uuid: string) {
  const dropdown = $(`conv-dropdown-${uuid}`);
  if (!dropdown) return;

  if (openDropdownId && openDropdownId !== uuid) {
    const oldDropdown = $(`conv-dropdown-${openDropdownId}`);
    if (oldDropdown) oldDropdown.classList.remove('open');
  }

  dropdown.classList.toggle('open');
  openDropdownId = dropdown.classList.contains('open') ? uuid : null;
}

async function deleteConversation(uuid: string) {
  const deletedConv = conversations.find(c => c.uuid === uuid);
  conversations = conversations.filter(c => c.uuid !== uuid);

  if (uuid === conversationId) {
    conversationId = null;
    parentMessageUuid = null;
    closeSidebar();
    showHome();
  } else {
    renderConversationsList();
  }

  try {
    await window.claude.deleteConversation(uuid);
  } catch (e) {
    console.error('Failed to delete conversation:', e);
    if (deletedConv) {
      conversations.push(deletedConv);
      conversations.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      renderConversationsList();
    }
  }
}

async function starConversation(uuid: string, isStarred: boolean) {
  const conv = conversations.find(c => c.uuid === uuid);
  const previousState = conv?.is_starred;
  if (conv) conv.is_starred = isStarred;
  renderConversationsList();

  try {
    await window.claude.starConversation(uuid, isStarred);
  } catch (e) {
    console.error('Failed to star conversation:', e);
    if (conv) conv.is_starred = previousState;
    renderConversationsList();
  }
}

function startRenameConversation(uuid: string) {
  const convItem = document.querySelector(`.conv-item[data-uuid="${uuid}"]`);
  if (!convItem) return;

  const dropdown = $(`conv-dropdown-${uuid}`);
  if (dropdown) dropdown.classList.remove('open');
  openDropdownId = null;

  const conv = conversations.find(c => c.uuid === uuid);
  const currentName = conv?.name || conv?.summary || '';

  const titleEl = convItem.querySelector('.conv-item-title');
  if (!titleEl) return;

  titleEl.innerHTML = `<input type="text" class="conv-rename-input" value="${escapeHtml(currentName)}" data-uuid="${uuid}">`;
  const input = titleEl.querySelector('input') as HTMLInputElement;
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishRename(uuid, input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renderConversationsList();
    }
  });

  input.addEventListener('blur', () => {
    finishRename(uuid, input.value);
  });
}

async function finishRename(uuid: string, newName: string) {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    renderConversationsList();
    return;
  }

  const conv = conversations.find(c => c.uuid === uuid);
  const previousName = conv?.name;
  if (conv) conv.name = trimmedName;
  renderConversationsList();

  try {
    await window.claude.renameConversation(uuid, trimmedName);
  } catch (e) {
    console.error('Failed to rename conversation:', e);
    if (conv) conv.name = previousName;
    renderConversationsList();
  }
}

// SVG icons
const pencilSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const closeSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const chevronSvg = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z"/></svg>`;

const FALLBACK_FAVICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PGNpcmNsZSBjeD0iOCIgY3k9IjgiIHI9IjciIGZpbGw9IiNkZGQiLz48L3N2Zz4=';

const toolLabels: Record<string, string> = {
  'web_search': 'Searching the web',
  'web_fetch': 'Fetching page',
  'bash_tool': 'Running command',
  'create_file': 'Creating file',
  'str_replace': 'Editing file',
  'view': 'Reading file',
  'conversation_search': 'Searching past chats',
  'recent_chats': 'Getting recent chats'
};

// Message functions
function addMessage(role: string, content: string, raw = false, storedParentUuid: string | null = null, extraClasses = '', attachments: UploadedAttachment[] = []): HTMLElement {
  const el = document.createElement('div');
  el.className = 'message ' + role + (extraClasses ? ' ' + extraClasses : '');

  const c = document.createElement('div');
  c.className = 'message-content';
  c.innerHTML = role === 'user' ? escapeHtml(content) : (raw ? content : parseMarkdown(content));
  el.appendChild(c);

  if (role === 'user' && attachments.length > 0) {
    const attachmentsEl = document.createElement('div');
    attachmentsEl.className = 'message-attachments';
    attachmentsEl.innerHTML = attachments.map(a => {
      const icon = a.file_type?.startsWith('image/') ? imageIconSvg : fileIconSvg;
      return `
        <div class="message-attachment-row">
          <div class="message-attachment-icon">${icon}</div>
          <div class="message-attachment-info">
            <div class="message-attachment-name">${escapeHtml(a.file_name)}</div>
            ${a.file_size ? `<div class="message-attachment-size">${formatFileSize(a.file_size)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
    el.appendChild(attachmentsEl);
  }

  if (role === 'user') {
    el.dataset.parentUuid = storedParentUuid || parentMessageUuid || conversationId || '';
    el.dataset.originalText = content;

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.innerHTML = pencilSvg;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startEditMessage(el);
    });
    el.appendChild(editBtn);
  }

  const messages = $('messages');
  if (messages) messages.appendChild(el);
  scrollToBottom();
  return el;
}

function addMessageRaw(role: string, htmlContent: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'message ' + role;

  const c = document.createElement('div');
  c.className = 'message-content';
  c.innerHTML = htmlContent;
  el.appendChild(c);

  c.querySelectorAll('.step-item').forEach(stepEl => {
    stepEl.addEventListener('click', () => stepEl.classList.toggle('expanded'));
  });

  const messages = $('messages');
  if (messages) messages.appendChild(el);
  scrollToBottom();
  return el;
}

// Edit message functions
function startEditMessage(msgEl: HTMLElement) {
  if (isLoading) return;
  msgEl.classList.add('editing');

  const contentEl = msgEl.querySelector('.message-content');
  if (!contentEl) return;

  const originalText = msgEl.dataset.originalText || contentEl.textContent || '';

  contentEl.innerHTML = `
    <div class="message-edit-container">
      <textarea class="message-edit-textarea">${escapeHtml(originalText)}</textarea>
      <div class="message-edit-actions">
        <button class="message-edit-cancel">${closeSvg}</button>
        <button class="message-edit-submit">${checkSvg}</button>
      </div>
    </div>
  `;

  const textarea = contentEl.querySelector('.message-edit-textarea') as HTMLTextAreaElement;
  const cancelBtn = contentEl.querySelector('.message-edit-cancel');
  const submitBtn = contentEl.querySelector('.message-edit-submit');

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitEditMessage(msgEl, textarea.value);
    } else if (e.key === 'Escape') {
      cancelEditMessage(msgEl);
    }
  });

  cancelBtn?.addEventListener('click', () => cancelEditMessage(msgEl));
  submitBtn?.addEventListener('click', () => submitEditMessage(msgEl, textarea.value));
}

function cancelEditMessage(msgEl: HTMLElement) {
  msgEl.classList.remove('editing');
  const contentEl = msgEl.querySelector('.message-content');
  const originalText = msgEl.dataset.originalText || '';
  if (contentEl) contentEl.innerHTML = escapeHtml(originalText);
}

async function submitEditMessage(msgEl: HTMLElement, newText: string) {
  if (isLoading) return;
  const trimmedText = newText.trim();

  if (!trimmedText) {
    cancelEditMessage(msgEl);
    return;
  }

  const branchParentUuid = msgEl.dataset.parentUuid;

  // Remove all messages after this one
  let nextEl = msgEl.nextElementSibling;
  while (nextEl) {
    const toRemove = nextEl;
    nextEl = nextEl.nextElementSibling;
    toRemove.remove();
  }

  msgEl.classList.remove('editing');
  msgEl.dataset.originalText = trimmedText;

  const contentEl = msgEl.querySelector('.message-content');
  if (contentEl) contentEl.innerHTML = escapeHtml(trimmedText);

  parentMessageUuid = branchParentUuid || null;

  isLoading = true;
  const sendBtn = $('send-btn');
  if (sendBtn) (sendBtn as HTMLButtonElement).disabled = true;

  currentStreamingElement = addMessage('assistant', '<div class="loading-dots"><span></span><span></span><span></span></div>', true);

  try {
    await window.claude.sendMessage(conversationId!, trimmedText, parentMessageUuid!);
  } catch (e: any) {
    if (currentStreamingElement) {
      const content = currentStreamingElement.querySelector('.message-content');
      if (content) content.innerHTML = '<span style="color:#FF453A">Error: ' + e.message + '</span>';
    }
    currentStreamingElement = null;
    isLoading = false;
    if (sendBtn) (sendBtn as HTMLButtonElement).disabled = false;
  }
}

// Tool result rendering
function buildToolResultContent(toolName: string, result: any, isError: boolean): string {
  if (!result) return '';

  if (result.type === 'rich_link' && result.link) {
    const link = result.link;
    const title = link.title || link.url || 'Fetched page';
    const url = link.url || '';
    let icon = link.icon_url || '';
    if (!icon && url) {
      try {
        const domain = new URL(url).hostname;
        icon = `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain)}`;
      } catch {}
    }
    if (!icon) icon = FALLBACK_FAVICON;
    return `
      <a class="link-card" href="${escapeHtml(url)}" target="_blank">
        <img class="link-card-icon" src="${escapeHtml(icon)}" onerror="this.onerror=null;this.src='${FALLBACK_FAVICON}'">
        <div class="link-card-info">
          <div class="link-card-title">${escapeHtml(title)}</div>
          <div class="link-card-url">${escapeHtml(url)}</div>
        </div>
      </a>
    `;
  }

  if (result.type === 'rich_content' && result.content) {
    let html = '<div class="chat-links">';
    for (const item of result.content.slice(0, 5)) {
      const title = item.title || 'Chat';
      const url = item.url || '';
      html += `
        <a class="chat-link-item" href="${escapeHtml(url)}" target="_blank">
          <span class="chat-link-icon">💬</span>
          <span class="chat-link-title">${escapeHtml(title)}</span>
        </a>
      `;
    }
    html += '</div>';
    return html;
  }

  if (result.type === 'json_block') {
    const code = result.code || '';
    const filename = result.filename || '';
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const returncode = result.returncode;

    if (stdout || stderr || returncode !== undefined) {
      const output = stdout || stderr || '';
      const hasError = isError || returncode !== 0;
      if (output) {
        return `<div class="tool-output ${hasError ? 'error' : ''}">${escapeHtml(output.substring(0, 500))}${output.length > 500 ? '...' : ''}</div>`;
      }
      return hasError ? '<div class="file-op error"><span class="file-op-icon">✗</span><span class="file-op-text">Command failed</span></div>' : '';
    }

    if (code && filename) {
      const shortFilename = filename.split('/').pop();
      const preview = code.substring(0, 200);
      return `
        <div class="file-preview">
          <div class="file-preview-header">${escapeHtml(shortFilename)}</div>
          <div class="tool-output">${escapeHtml(preview)}${code.length > 200 ? '...' : ''}</div>
        </div>
      `;
    }

    if (code) {
      return `<div class="tool-output">${escapeHtml(code.substring(0, 300))}${code.length > 300 ? '...' : ''}</div>`;
    }
  }

  if (result.type === 'text') {
    const text = result.text || '';
    if (text.toLowerCase().includes('success')) {
      return `<div class="file-op success"><span class="file-op-icon">✓</span><span class="file-op-text">${escapeHtml(text)}</span></div>`;
    }
    return `<div class="tool-output ${isError ? 'error' : ''}">${escapeHtml(text)}</div>`;
  }

  if (Array.isArray(result)) {
    let html = '<div class="search-results">';
    for (const item of result.slice(0, 5)) {
      const siteDomain = item.metadata?.site_domain || '';
      const siteName = item.metadata?.site_name || siteDomain || '';
      let favicon = item.metadata?.favicon_url || '';
      if (!favicon && siteDomain) {
        favicon = `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(siteDomain)}`;
      }
      if (!favicon) favicon = FALLBACK_FAVICON;
      html += `
        <a class="search-result-item" href="${escapeHtml(item.url)}" target="_blank">
          <img class="search-result-favicon" src="${escapeHtml(favicon)}" onerror="this.onerror=null;this.src='${FALLBACK_FAVICON}'">
          <div class="search-result-info">
            <div class="search-result-title">${escapeHtml(item.title)}</div>
            <div class="search-result-site">${escapeHtml(siteName)}</div>
          </div>
        </a>
      `;
    }
    html += '</div>';
    return html;
  }

  if (result.link) {
    const link = result.link;
    const title = link.title || link.url || 'Fetched page';
    const url = link.url || '';
    let icon = link.icon_url || '';
    if (!icon && url) {
      try {
        const domain = new URL(url).hostname;
        icon = `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(domain)}`;
      } catch {}
    }
    if (!icon) icon = FALLBACK_FAVICON;
    return `
      <a class="link-card" href="${escapeHtml(url)}" target="_blank">
        <img class="link-card-icon" src="${escapeHtml(icon)}" onerror="this.onerror=null;this.src='${FALLBACK_FAVICON}'">
        <div class="link-card-info">
          <div class="link-card-title">${escapeHtml(title)}</div>
          <div class="link-card-url">${escapeHtml(url)}</div>
        </div>
      </a>
    `;
  }

  if (result.rich_content) {
    let html = '<div class="chat-links">';
    const items = Array.isArray(result.rich_content) ? result.rich_content : [result.rich_content];
    for (const item of items.slice(0, 5)) {
      const title = item.title || item.text || 'Chat';
      const url = item.url || item.href || '';
      html += `
        <a class="chat-link-item" href="${escapeHtml(url)}" target="_blank">
          <span class="chat-link-icon">💬</span>
          <span class="chat-link-title">${escapeHtml(title)}</span>
        </a>
      `;
    }
    html += '</div>';
    return html;
  }

  if (result.text) {
    return `<div class="tool-output ${isError ? 'error' : ''}">${escapeHtml(result.text)}</div>`;
  }

  if (typeof result === 'string') {
    return `<div class="tool-output ${isError ? 'error' : ''}">${escapeHtml(result)}</div>`;
  }

  return '';
}

// Step building
function buildStepItem(step: Step, isActive: boolean): string {
  if (step.type === 'thinking') {
    const summary = step.thinkingSummary || step.summary;
    const label = summary ? escapeHtml(summary) : 'Thinking';
    const idx = step.index !== undefined ? step.index : '';
    return `
      <div class="step-item thinking" data-index="${idx}">
        <div class="step-timeline-col">
          <div class="step-dot-row">
            <div class="step-line-top"></div>
            <div class="step-dot"></div>
            <div class="step-line-bottom"></div>
          </div>
          <div class="step-line-extend"></div>
        </div>
        <div class="step-content-col">
          <div class="step-header">
            <span class="step-label">${label}</span>
            ${isActive ? '<div class="step-spinner"></div>' : `<span class="step-chevron">${chevronSvg}</span>`}
          </div>
          <div class="step-content">
            <div class="step-text">${escapeHtml(step.thinkingText || step.text || '')}</div>
          </div>
        </div>
      </div>
    `;
  } else if (step.type === 'tool') {
    const message = step.toolMessage || step.message;
    const label = message || toolLabels[step.toolName || ''] || `Using ${step.toolName}`;
    const resultHtml = buildToolResultContent(step.toolName || '', step.toolResult, step.isError || false);
    const idx = step.index !== undefined ? step.index : '';

    return `
      <div class="step-item tool ${step.toolResult ? '' : 'active'}" data-index="${idx}">
        <div class="step-timeline-col">
          <div class="step-dot-row">
            <div class="step-line-top"></div>
            <div class="step-dot"></div>
            <div class="step-line-bottom"></div>
          </div>
          <div class="step-line-extend"></div>
        </div>
        <div class="step-content-col">
          <div class="step-header">
            <span class="step-label">${escapeHtml(label)}</span>
            ${isActive && !step.toolResult ? '<div class="step-spinner"></div>' : `<span class="step-chevron">${chevronSvg}</span>`}
          </div>
          <div class="step-content">${resultHtml}</div>
        </div>
      </div>
    `;
  }
  return '';
}

function buildInterleavedContent(steps: Step[]): string {
  if (!steps || steps.length === 0) return '';

  let html = '';
  let currentTimelineSteps: Step[] = [];

  for (const step of steps) {
    if (step.type === 'text') {
      if (currentTimelineSteps.length > 0) {
        html += '<div class="steps-timeline">';
        for (const ts of currentTimelineSteps) {
          html += buildStepItem(ts, false);
        }
        html += '</div>';
        currentTimelineSteps = [];
      }
      html += parseMarkdown(step.text || '', step.citations);
    } else {
      currentTimelineSteps.push(step);
    }
  }

  if (currentTimelineSteps.length > 0) {
    html += '<div class="steps-timeline">';
    for (const ts of currentTimelineSteps) {
      html += buildStepItem(ts, false);
    }
    html += '</div>';
  }

  return html;
}

function buildStreamingContent(): string {
  const allBlocks: Step[] = [];

  streamingBlocks.thinkingBlocks.forEach((block, idx) => {
    allBlocks.push({
      type: 'thinking',
      index: idx,
      thinkingText: block.text,
      thinkingSummary: block.summary,
      isActive: block.isActive
    });
  });

  streamingBlocks.toolBlocks.forEach((block, idx) => {
    allBlocks.push({
      type: 'tool',
      index: idx,
      toolName: block.name,
      toolMessage: block.message,
      toolResult: block.result,
      isError: block.isError,
      isActive: block.isRunning
    });
  });

  streamingBlocks.textBlocks.forEach((block, idx) => {
    allBlocks.push({
      type: 'text',
      index: idx,
      text: block.text
    });
  });

  if (allBlocks.length === 0) return '';

  allBlocks.sort((a, b) => (a.index || 0) - (b.index || 0));

  let html = '';
  let currentTimelineSteps: Step[] = [];

  for (const step of allBlocks) {
    if (step.type === 'text') {
      if (currentTimelineSteps.length > 0) {
        html += '<div class="steps-timeline">';
        for (const ts of currentTimelineSteps) {
          html += buildStepItem(ts, ts.isActive || false);
        }
        html += '</div>';
        currentTimelineSteps = [];
      }
      html += parseMarkdown(step.text || '');
    } else {
      currentTimelineSteps.push(step);
    }
  }

  if (currentTimelineSteps.length > 0) {
    html += '<div class="steps-timeline">';
    for (const ts of currentTimelineSteps) {
      html += buildStepItem(ts, ts.isActive || false);
    }
    html += '</div>';
  }

  return html;
}

function updateStreamingContent() {
  if (!currentStreamingElement) return;
  const contentEl = currentStreamingElement.querySelector('.message-content');
  if (!contentEl) return;

  const expandedIndices = new Set<string>();
  contentEl.querySelectorAll('.step-item.expanded').forEach(el => {
    const idx = el.getAttribute('data-index');
    if (idx) expandedIndices.add(idx);
  });

  let html = buildStreamingContent();

  if (!html) {
    html = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  }

  contentEl.innerHTML = html;

  // Add click listeners to step items
  contentEl.querySelectorAll('.step-item').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('expanded'));
  });

  expandedIndices.forEach(idx => {
    const el = contentEl.querySelector(`.step-item[data-index="${idx}"]`);
    if (el) el.classList.add('expanded');
  });
}

// Parse stored message content
function parseStoredMessageContent(content: ContentBlock[]): Step[] {
  const steps: Step[] = [];
  let currentToolUse: Step | null = null;

  for (const block of content) {
    if (block.type === 'thinking') {
      const lastSummary = block.summaries && block.summaries.length > 0
        ? block.summaries[block.summaries.length - 1].summary
        : undefined;
      steps.push({
        type: 'thinking',
        thinkingText: block.thinking,
        thinkingSummary: lastSummary
      });
    } else if (block.type === 'tool_use') {
      currentToolUse = {
        type: 'tool',
        toolName: block.name,
        toolMessage: block.message || block.display_content?.text,
        toolInput: block.input
      };
    } else if (block.type === 'tool_result') {
      if (currentToolUse && currentToolUse.toolName === block.name) {
        let resultData: any = null;
        if (block.display_content) {
          resultData = block.display_content;
        } else if (block.content && Array.isArray(block.content)) {
          if (block.name === 'web_search') {
            resultData = (block.content as any[]).filter(c => c.type === 'knowledge').map(c => ({
              title: c.title,
              url: c.url,
              metadata: c.metadata
            }));
          } else {
            const textContent = (block.content as any[]).find(c => c.type === 'text');
            if (textContent) {
              resultData = { type: 'text', text: textContent.text };
            }
          }
        }
        currentToolUse.toolResult = resultData;
        currentToolUse.isError = block.is_error;
        steps.push(currentToolUse);
        currentToolUse = null;
      }
    } else if (block.type === 'text') {
      steps.push({
        type: 'text',
        text: block.text,
        citations: block.citations
      });
    }
  }

  if (currentToolUse) {
    steps.push(currentToolUse);
  }

  return steps;
}

// Load conversation
async function loadConversation(convId: string) {
  try {
    clearAttachments();
    const conv = await window.claude.loadConversation(convId);
    conversationId = convId;
    currentConversationTitle = conv.name || 'Conversation';
    currentConversationMessages = [];

    isLoading = false;
    const sendBtn = $('send-btn');
    const stopBtn = $('stop-btn');
    if (sendBtn) sendBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.remove('visible');

    showChat();

    const messagesEl = $('messages');
    if (messagesEl) messagesEl.innerHTML = '';

    if (conv.chat_messages && conv.chat_messages.length > 0) {
      let prevMsgUuid = convId;

      for (const msg of conv.chat_messages) {
        const role = msg.sender === 'human' ? 'user' : 'assistant';

        if (role === 'user') {
          let text = '';
          if (msg.content && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'text') {
                text += block.text || '';
              }
            }
          } else if (msg.text) {
            text = msg.text;
          }

          const messageFiles = msg.files_v2 || msg.files || [];
          const attachments: UploadedAttachment[] = messageFiles.map(f => ({
            id: f.file_uuid,
            document_id: f.file_uuid,
            file_name: f.file_name,
            file_size: 0, // Size not available in loaded messages
            file_type: f.file_kind === 'image' ? 'image/png' : 'application/octet-stream',
            previewUrl: f.preview_url || f.thumbnail_url
          }));

          if (text || attachments.length > 0) {
            addMessage('user', text, false, prevMsgUuid, '', attachments);
            currentConversationMessages.push({ role: 'human', content: text, timestamp: msg.created_at });
          }
        } else {
          let assistantText = '';
          if (msg.content && Array.isArray(msg.content)) {
            const steps = parseStoredMessageContent(msg.content);
            if (steps.length > 0) {
              const html = buildInterleavedContent(steps);
              addMessageRaw('assistant', html);
              // Extract text content for export
              for (const step of steps) {
                if (step.type === 'text') {
                  assistantText += step.text || '';
                }
              }
            }
          } else if (msg.text) {
            addMessage('assistant', msg.text);
            assistantText = msg.text;
          }
          if (assistantText) {
            currentConversationMessages.push({ role: 'assistant', content: assistantText, timestamp: msg.created_at });
          }
        }

        if (msg.uuid) {
          prevMsgUuid = msg.uuid;
          parentMessageUuid = msg.uuid;
        }
      }
    } else {
      if (messagesEl) {
        messagesEl.innerHTML = '<div class="empty-state" id="empty-state"><div class="empty-state-icon">✦</div><p>What can I help with?</p><span class="hint">Claude is ready</span></div>';
      }
      parentMessageUuid = convId;
    }

    closeSidebar();
    renderConversationsList();
    scrollToBottom();
  } catch (e) {
    console.error('Failed to load conversation:', e);
  }
}

// Export conversation to Markdown
async function exportConversation() {
  if (!conversationId || currentConversationMessages.length === 0) {
    console.error('No conversation to export');
    return;
  }

  try {
    const result = await window.claude.exportConversationMarkdown({
      title: currentConversationTitle,
      messages: currentConversationMessages
    });

    if (result.success) {
      console.log('Conversation exported to:', result.filePath);
    } else if (!result.canceled) {
      console.error('Failed to export conversation');
    }
  } catch (e) {
    console.error('Failed to export conversation:', e);
  }
}

// Auth functions
async function login() {
  const loginError = $('login-error');
  if (loginError) loginError.textContent = '';

  const r = await window.claude.login();
  if (r.success) {
    showChat();
    await startNewConversation();
    loadConversationsList();
  } else {
    if (loginError) loginError.textContent = r.error || 'Failed';
  }
}

async function logout() {
  await window.claude.logout();
  conversationId = null;
  parentMessageUuid = null;
  conversations = [];
  clearAttachments();

  const messagesEl = $('messages');
  if (messagesEl) {
    messagesEl.innerHTML = '<div class="empty-state" id="empty-state"><div class="empty-state-icon">✦</div><p>What can I help with?</p><span class="hint">Claude is ready</span></div>';
  }
  showLogin();
}

async function startNewConversation() {
  try {
    const r = await window.claude.createConversation();
    conversationId = r.conversationId;
    parentMessageUuid = r.parentMessageUuid || r.uuid || crypto.randomUUID();
  } catch (e: any) {
    addMessage('assistant', 'Failed: ' + e.message);
  }
}

function newChat() {
  conversationId = null;
  parentMessageUuid = null;
  clearAttachments();
  const homeInput = $('home-input') as HTMLTextAreaElement;
  if (homeInput) homeInput.value = '';
  closeSidebar();
  showHome();
}

// Send message functions
async function sendFromHome() {
  const input = $('home-input') as HTMLTextAreaElement;
  const msg = input?.value.trim();
  if (!msg || isLoading) return;
  if (uploadingAttachments) {
    attachmentError = 'Please wait for attachments to finish uploading';
    renderAttachmentList();
    return;
  }

  const attachmentPayloads = getAttachmentPayloads();
  const userAttachmentCopies = [...pendingAttachments];

  isLoading = true;
  const homeSendBtn = $('home-send-btn') as HTMLButtonElement;
  if (homeSendBtn) homeSendBtn.disabled = true;

  try {
    const r = await window.claude.createConversation(selectedModel);
    conversationId = r.conversationId;
    parentMessageUuid = r.parentMessageUuid || r.uuid || crypto.randomUUID();

    const homeContainer = $('home');
    const chatContainer = $('chat');

    if (homeContainer) homeContainer.classList.add('transitioning');

    await new Promise(resolve => setTimeout(resolve, 350));

    const messagesEl = $('messages');
    if (messagesEl) messagesEl.innerHTML = '';
    if (chatContainer) chatContainer.classList.add('entering');

    if (homeContainer) homeContainer.classList.remove('active');
    if (chatContainer) chatContainer.classList.add('active');

    const modelBadge = document.querySelector('.model-badge');
    if (modelBadge) modelBadge.textContent = modelDisplayNames[selectedModel] || 'Opus 4.5';

    const sidebarTab = $('sidebar-tab');
    if (sidebarTab) sidebarTab.classList.remove('hidden');

    addMessage('user', msg, false, null, 'fly-in', userAttachmentCopies);

    await new Promise(resolve => setTimeout(resolve, 200));

    currentStreamingElement = addMessage('assistant', '<div class="loading-dots"><span></span><span></span><span></span></div>', true, null, 'fade-in');

    const sendBtn = $('send-btn');
    const stopBtn = $('stop-btn');
    if (sendBtn) sendBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.add('visible');

    setTimeout(() => {
      if (homeContainer) homeContainer.classList.remove('transitioning');
      if (chatContainer) chatContainer.classList.remove('entering');
    }, 600);

    await window.claude.sendMessage(conversationId, msg, parentMessageUuid!, attachmentPayloads);

    clearAttachments();

    window.claude.generateTitle(conversationId, msg).then(() => {
      loadConversationsList();
    }).catch(err => {
      console.warn('Failed to generate title:', err);
      loadConversationsList();
    });

    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
  } catch (e: any) {
    if (currentStreamingElement) {
      const content = currentStreamingElement.querySelector('.message-content');
      if (content) content.innerHTML = '<span style="color:#FF453A">Error: ' + e.message + '</span>';
    }
    currentStreamingElement = null;
    isLoading = false;
    if (homeSendBtn) homeSendBtn.disabled = false;

    const sendBtn = $('send-btn');
    const stopBtn = $('stop-btn');
    if (sendBtn) sendBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.remove('visible');
  }
}

async function sendMessage() {
  const input = $('input') as HTMLTextAreaElement;
  const msg = input?.value.trim();
  if (!msg || isLoading || !conversationId) return;
  if (uploadingAttachments) {
    attachmentError = 'Please wait for attachments to finish uploading';
    renderAttachmentList();
    return;
  }

  const attachmentPayloads = getAttachmentPayloads();
  const userAttachmentCopies = [...pendingAttachments];

  isLoading = true;
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const sendBtn = $('send-btn');
  const stopBtn = $('stop-btn');
  if (sendBtn) sendBtn.classList.add('hidden');
  if (stopBtn) stopBtn.classList.add('visible');

  hideEmptyState();
  addMessage('user', msg, false, null, '', userAttachmentCopies);
  currentConversationMessages.push({ role: 'human', content: msg, timestamp: new Date().toISOString() });
  currentStreamingElement = addMessage('assistant', '<div class="loading-dots"><span></span><span></span><span></span></div>', true);

  try {
    await window.claude.sendMessage(conversationId, msg, parentMessageUuid!, attachmentPayloads);
    clearAttachments();
  } catch (e: any) {
    if (currentStreamingElement) {
      const content = currentStreamingElement.querySelector('.message-content');
      if (content) content.innerHTML = '<span style="color:#FF453A">Error: ' + e.message + '</span>';
    }
    currentStreamingElement = null;
    isLoading = false;
    if (sendBtn) sendBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.remove('visible');
  }
}

async function stopGenerating() {
  if (!conversationId || !isLoading) return;

  try {
    await window.claude.stopResponse(conversationId);
    const conv = await window.claude.loadConversation(conversationId);
    if (conv.chat_messages && conv.chat_messages.length > 0) {
      const lastMsg = conv.chat_messages[conv.chat_messages.length - 1];
      if (lastMsg.uuid) {
        parentMessageUuid = lastMsg.uuid;
      }
    }
  } catch (e) {
    console.error('Stop failed:', e);
  }

  if (currentStreamingElement) {
    const content = currentStreamingElement.querySelector('.message-content');
    const hasLoadingDots = content?.querySelector('.loading-dots');
    const hasContent = streamingBlocks.textContent.trim().length > 0;

    if (hasLoadingDots && !hasContent) {
      currentStreamingElement.remove();
    } else if (hasContent) {
      const finalHtml = buildInterleavedContent([]);
      if (content) content.innerHTML = finalHtml || '<span style="opacity:0.5;font-style:italic">Stopped</span>';
    }
  }

  isLoading = false;
  const sendBtn = $('send-btn');
  const stopBtn = $('stop-btn');
  if (sendBtn) sendBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.remove('visible');
  currentStreamingElement = null;
  resetStreamingBlocks();

  const inputEl = $('input');
  if (inputEl) inputEl.focus();
}

// Initialize
async function init() {
  if (await window.claude.getAuthStatus()) {
    showHome();
    loadConversationsList();
  } else {
    showLogin();
  }

  // Set up message listeners
  window.claude.onMessageThinking(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      hideEmptyState();
      streamingBlocks.thinkingBlocks.set(d.blockIndex, {
        text: d.thinkingText || '',
        isActive: d.isThinking
      });
      updateStreamingContent();
    }
  });

  window.claude.onMessageThinkingStream(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      const block = streamingBlocks.thinkingBlocks.get(d.blockIndex) || { isActive: true };
      block.text = d.thinking;
      if (d.summary) block.summary = d.summary;
      streamingBlocks.thinkingBlocks.set(d.blockIndex, block);
      updateStreamingContent();
    }
  });

  window.claude.onMessageToolUse(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      hideEmptyState();
      streamingBlocks.toolBlocks.set(d.blockIndex, {
        name: d.toolName,
        message: d.message,
        input: d.input,
        isRunning: d.isRunning
      });
      updateStreamingContent();
      scrollToBottom();
    }
  });

  window.claude.onMessageToolResult(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      streamingBlocks.toolBlocks.forEach((block) => {
        if (block.name === d.toolName && block.isRunning) {
          block.result = d.result;
          block.isError = d.isError;
          block.isRunning = false;
        }
      });
      updateStreamingContent();
      scrollToBottom();
    }
  });

  window.claude.onMessageStream(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      hideEmptyState();
      streamingBlocks.textContent = d.fullText;
      if (d.blockIndex !== undefined) {
        streamingBlocks.textBlocks.set(d.blockIndex, { text: d.fullText });
      }
      updateStreamingContent();
      scrollToBottom();
    }
  });

  window.claude.onMessageComplete(d => {
    if (currentStreamingElement && d.conversationId === conversationId) {
      const finalHtml = buildInterleavedContent(d.steps);
      const content = currentStreamingElement.querySelector('.message-content');
      if (content) {
        content.innerHTML = finalHtml;
        // Add click listeners to step items
        content.querySelectorAll('.step-item').forEach(el => {
          el.addEventListener('click', () => el.classList.toggle('expanded'));
        });
      }
      parentMessageUuid = d.messageUuid;

      // Store assistant message for export
      if (d.fullText) {
        currentConversationMessages.push({ role: 'assistant', content: d.fullText, timestamp: new Date().toISOString() });
      }

      currentStreamingElement = null;
      resetStreamingBlocks();
      isLoading = false;

      const sendBtn = $('send-btn');
      const stopBtn = $('stop-btn');
      if (sendBtn) sendBtn.classList.remove('hidden');
      if (stopBtn) stopBtn.classList.remove('visible');

      const inputEl = $('input');
      if (inputEl) inputEl.focus();
    }
  });
}

// Set up event listeners
function setupEventListeners() {
  // Login button
  $('login-btn')?.addEventListener('click', login);

  // New chat button
  $('new-chat-btn')?.addEventListener('click', newChat);

  // Chat header menu
  const menuBtn = $('menu-btn');
  const menuDropdown = $('menu-dropdown');

  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown?.classList.toggle('visible');
  });

  // Menu items
  $('menu-new-window')?.addEventListener('click', () => {
    menuDropdown?.classList.remove('visible');
    window.claude.newWindow();
  });

  $('menu-export')?.addEventListener('click', () => {
    menuDropdown?.classList.remove('visible');
    exportConversation();
  });

  $('menu-signout')?.addEventListener('click', () => {
    menuDropdown?.classList.remove('visible');
    logout();
  });

  // Home page menu
  const homeMenuBtn = $('home-menu-btn');
  const homeMenuDropdown = $('home-menu-dropdown');

  homeMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    homeMenuDropdown?.classList.toggle('visible');
  });

  $('home-menu-new-window')?.addEventListener('click', () => {
    homeMenuDropdown?.classList.remove('visible');
    window.claude.newWindow();
  });

  $('home-menu-settings')?.addEventListener('click', () => {
    homeMenuDropdown?.classList.remove('visible');
    window.claude.openSettings();
  });

  $('home-menu-signout')?.addEventListener('click', () => {
    homeMenuDropdown?.classList.remove('visible');
    logout();
  });

  // Close all menus when clicking outside
  document.addEventListener('click', () => {
    menuDropdown?.classList.remove('visible');
    homeMenuDropdown?.classList.remove('visible');
  });

  // Sidebar toggle
  $('sidebar-tab')?.addEventListener('click', toggleSidebar);
  $('sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Model selection
  $$('.model-option').forEach(btn => {
    btn.addEventListener('click', () => selectModel(btn as HTMLElement));
  });

  // Home input
  const homeInput = $('home-input') as HTMLTextAreaElement;
  homeInput?.addEventListener('input', () => autoResizeHome(homeInput));
  homeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFromHome();
    }
  });

  // Home send button
  $('home-send-btn')?.addEventListener('click', sendFromHome);

  // Chat input
  const chatInput = $('input') as HTMLTextAreaElement;
  chatInput?.addEventListener('input', () => autoResize(chatInput));
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Attachment buttons
  const fileInput = $('file-input') as HTMLInputElement;
  $('attach-btn')?.addEventListener('click', () => fileInput?.click());
  $('home-attach-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    handleFileSelection(fileInput.files);
    fileInput.value = '';
  });

  // Send button
  $('send-btn')?.addEventListener('click', sendMessage);

  // Stop button
  $('stop-btn')?.addEventListener('click', stopGenerating);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (openDropdownId && !(e.target as HTMLElement).closest('.conv-item')) {
      const dropdown = $(`conv-dropdown-${openDropdownId}`);
      if (dropdown) dropdown.classList.remove('open');
      openDropdownId = null;
    }
  });

  // Sidebar tab indicator
  const sidebarTab = $('sidebar-tab');
  const sidebarTabIndicator = $('sidebar-tab-indicator');
  sidebarTab?.addEventListener('mousemove', (e) => {
    if (!sidebarTabIndicator || !sidebarTab) return;
    const rect = sidebarTab.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    sidebarTabIndicator.style.top = relativeY + 'px';
  });

  // Sidebar hover to open
  let hoverTimeout: number;
  sidebarTab?.addEventListener('mouseenter', () => {
    hoverTimeout = window.setTimeout(() => {
      toggleSidebar();
    }, 200);
  });
  sidebarTab?.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
  });
}

// Start the app
init();
setupEventListeners();
renderAttachmentList();
