import { parseMarkdown } from './markdown.js';

// Use any for window.claude - it's typed in preload but we don't need strict types here
const claude = (window as any).claude;

interface StepData {
  type: string;
  el: HTMLElement;
  name?: string;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

// DOM Elements
const input = document.getElementById('spotlight-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const newChatBtn = document.getElementById('new-chat-btn') as HTMLButtonElement;
const inputRow = document.getElementById('input-row');
const messagesArea = document.getElementById('messages-area');
const container = document.getElementById('container');

// State
let isLoading = false;
let currentMessageEl: HTMLElement | null = null;
let currentStepsContainer: HTMLElement | null = null;
let currentResponseEl: HTMLElement | null = null;
let stepIndex = 0;
let steps: StepData[] = [];
let currentThinkingStep: HTMLElement | null = null;
let currentToolStep: HTMLElement | null = null;
let hasHistory = false;

// Constants
const chevronSvg = `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M14.128 7.16482C14.3126 6.95983 14.6298 6.94336 14.835 7.12771C15.0402 7.31242 15.0567 7.62952 14.8721 7.83477L10.372 12.835L10.2939 12.9053C10.2093 12.9667 10.1063 13 9.99995 13C9.85833 12.9999 9.72264 12.9402 9.62788 12.835L5.12778 7.83477L5.0682 7.75273C4.95072 7.55225 4.98544 7.28926 5.16489 7.12771C5.34445 6.96617 5.60969 6.95939 5.79674 7.09744L5.87193 7.16482L9.99995 11.7519L14.128 7.16482Z"/></svg>`;

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

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function updateWindowSize() {
  if (!container) return;
  const containerHeight = container.offsetHeight;
  const newHeight = Math.max(56, Math.min(containerHeight + 2, 700));
  claude.spotlightResize(newHeight);
  if (messagesArea) messagesArea.scrollTop = messagesArea.scrollHeight;
}

function showNewChatButton(show: boolean) {
  if (newChatBtn) {
    newChatBtn.classList.toggle('visible', show);
  }
}

// Render existing messages from history
function renderHistoryMessages(messages: Message[]) {
  if (!messagesArea) return;

  for (const msg of messages) {
    const msgEl = document.createElement('div');

    if (msg.role === 'user') {
      msgEl.className = 'message';
      msgEl.innerHTML = `<div class="user-message">${escapeHtml(msg.text)}</div>`;
    } else if (msg.role === 'assistant') {
      msgEl.className = 'message ai-message';
      const responseEl = document.createElement('div');
      responseEl.className = 'ai-response';
      responseEl.innerHTML = parseMarkdown(msg.text);
      msgEl.appendChild(responseEl);
    }

    messagesArea.appendChild(msgEl);
  }

  // Show messages area and update layout
  inputRow?.classList.add('no-border');
  messagesArea.classList.add('visible');
  updateWindowSize();
}

// Load history and draft on startup
async function loadHistory() {
  try {
    const result = await claude.spotlightGetHistory();
    if (result.hasHistory && result.messages.length > 0) {
      hasHistory = true;
      renderHistoryMessages(result.messages);
      showNewChatButton(true);
    }
    // Restore draft input
    if (result.draftInput) {
      input.value = result.draftInput;
      sendBtn.classList.toggle('visible', result.draftInput.length > 0);
    }
  } catch (e) {
    console.error('Failed to load spotlight history:', e);
  }
}

// Start new chat
async function startNewChat() {
  await claude.spotlightNewChat();

  // Clear UI
  if (messagesArea) {
    messagesArea.innerHTML = '';
    messagesArea.classList.remove('visible');
  }
  inputRow?.classList.remove('no-border');

  // Clear input
  input.value = '';
  sendBtn.classList.remove('visible');

  hasHistory = false;
  showNewChatButton(false);
  updateWindowSize();

  input.focus();
}

// Step functions
function createStepItem(type: string, label: string, isActive = true): HTMLElement {
  const div = document.createElement('div');
  div.className = `step-item ${type}${isActive ? '' : ' done'}`;
  div.dataset.index = String(stepIndex++);
  div.innerHTML = `
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
        ${isActive ? '<div class="step-spinner"></div>' : `<span class="step-chevron">${chevronSvg}</span>`}
      </div>
      <div class="step-content">
        <div class="step-text"></div>
      </div>
    </div>
  `;

  // Add click listener for expand/collapse
  const header = div.querySelector('.step-header');
  header?.addEventListener('click', () => div.classList.toggle('expanded'));

  return div;
}

function updateStepContent(stepEl: HTMLElement, text: string) {
  const textEl = stepEl.querySelector('.step-text');
  if (textEl) textEl.textContent = text;
}

function markStepComplete(stepEl: HTMLElement, label?: string) {
  stepEl.classList.add('done');
  stepEl.classList.remove('active');
  const spinner = stepEl.querySelector('.step-spinner');
  if (spinner) {
    spinner.outerHTML = `<span class="step-chevron">${chevronSvg}</span>`;
  }
  if (label) {
    const labelEl = stepEl.querySelector('.step-label');
    if (labelEl) labelEl.textContent = label;
  }
}

// Send message
async function sendMessage() {
  const message = input.value.trim();
  if (!message) return;

  isLoading = true;
  sendBtn.disabled = true;
  inputRow?.classList.add('no-border');
  messagesArea?.classList.add('visible');

  // Show new chat button since we now have history
  hasHistory = true;
  showNewChatButton(true);

  // Create user message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'message';
  userMsgEl.innerHTML = `<div class="user-message">${escapeHtml(message)}</div>`;
  messagesArea?.appendChild(userMsgEl);

  // Create AI message container
  currentMessageEl = document.createElement('div');
  currentMessageEl.className = 'message ai-message';

  currentStepsContainer = document.createElement('div');
  currentStepsContainer.className = 'steps-container';

  currentResponseEl = document.createElement('div');
  currentResponseEl.className = 'ai-response';
  currentResponseEl.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

  currentMessageEl.appendChild(currentStepsContainer);
  currentMessageEl.appendChild(currentResponseEl);
  messagesArea?.appendChild(currentMessageEl);

  // Reset step tracking
  stepIndex = 0;
  steps = [];
  currentThinkingStep = null;
  currentToolStep = null;

  updateWindowSize();

  // Clear input
  input.value = '';
  sendBtn.classList.remove('visible');

  try {
    await claude.spotlightSend(message);
  } catch (err: any) {
    if (currentResponseEl) {
      currentResponseEl.textContent = 'Error: ' + (err.message || 'Failed to get response');
    }
    isLoading = false;
    sendBtn.disabled = false;
  }
}

// Set up stream listeners once at module level
claude.onSpotlightStream((data: any) => {
  if (currentResponseEl) {
    currentResponseEl.innerHTML = parseMarkdown(data.fullText);
    updateWindowSize();
  }
});

claude.onSpotlightComplete((data: any) => {
  if (currentResponseEl) {
    currentResponseEl.innerHTML = parseMarkdown(data.fullText);
  }
  isLoading = false;
  sendBtn.disabled = false;
  updateWindowSize();
});

// Thinking listeners
claude.onSpotlightThinking((data: any) => {
  if (data.isThinking) {
    currentThinkingStep = createStepItem('thinking', 'Thinking...', true);
    currentStepsContainer?.appendChild(currentThinkingStep);
    steps.push({ type: 'thinking', el: currentThinkingStep });
    updateWindowSize();
  } else if (currentThinkingStep) {
    const summary = data.thinkingText ? data.thinkingText.substring(0, 50) + '...' : 'Thought';
    markStepComplete(currentThinkingStep, summary);
    if (data.thinkingText) {
      updateStepContent(currentThinkingStep, data.thinkingText);
    }
    currentThinkingStep = null;
    updateWindowSize();
  }
});

claude.onSpotlightThinkingStream((data: any) => {
  if (currentThinkingStep) {
    updateStepContent(currentThinkingStep, data.thinking);
    updateWindowSize();
  }
});

// Tool listeners
claude.onSpotlightTool((data: any) => {
  if (data.isRunning) {
    const label = data.message || toolLabels[data.toolName] || `Using ${data.toolName}`;
    currentToolStep = createStepItem('tool', label, true);
    currentStepsContainer?.appendChild(currentToolStep);
    steps.push({ type: 'tool', el: currentToolStep, name: data.toolName });
    updateWindowSize();
  }
});

claude.onSpotlightToolResult((data: any) => {
  if (currentToolStep) {
    const label = toolLabels[data.toolName] || `Used ${data.toolName}`;
    markStepComplete(currentToolStep, label);
    if (data.result) {
      const resultText = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
      updateStepContent(currentToolStep, resultText.substring(0, 500));
    }
    if (data.isError) {
      currentToolStep.classList.add('error');
    }
    currentToolStep = null;
    updateWindowSize();
  }
});

// Event listeners
input.addEventListener('input', () => {
  const hasText = input.value.trim().length > 0;
  sendBtn.classList.toggle('visible', hasText);
  sendBtn.disabled = !hasText || isLoading;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && input.value.trim() && !isLoading) {
    e.preventDefault();
    sendMessage();
  }
  if (e.key === 'Escape') {
    window.close();
  }
});

sendBtn.addEventListener('click', () => {
  if (input.value.trim() && !isLoading) {
    sendMessage();
  }
});

newChatBtn.addEventListener('click', () => {
  startNewChat();
});

// Handle code copy button clicks 
document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const copyBtn = target.closest('.code-copy-btn') as HTMLButtonElement;
  if (!copyBtn) return;

  const code = copyBtn.dataset.code;
  if (!code) return;

  const textarea = document.createElement('textarea');
  textarea.innerHTML = code;
  const decodedCode = textarea.value;

  try {
    await navigator.clipboard.writeText(decodedCode);
    copyBtn.classList.add('copied');

    const originalSvg = copyBtn.innerHTML;
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`;

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = originalSvg;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy code:', err);
  }
});


// Focus input on load and load history
window.addEventListener('load', () => {
  input.focus();
  loadHistory();
});

// Clean up on close
window.addEventListener('beforeunload', () => {
  // Save draft input before closing
  claude.spotlightSaveDraft(input.value);
  claude.removeSpotlightListeners();
  claude.spotlightReset();
});
