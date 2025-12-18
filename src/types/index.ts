// Settings schema
export interface SettingsSchema {
  spotlightKeybind: string;
  spotlightPersistHistory: boolean;
  newWindowKeybind: string;
}

// Store schema for electron-store
export interface StoreSchema {
  orgId?: string;
  deviceId?: string;
  anonymousId?: string;
  settings: SettingsSchema;
}

// File attachment payloads
export interface AttachmentPayload {
  document_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_url?: string;
  extracted_content?: string;
}

export interface UploadFilePayload {
  name: string;
  size: number;
  type: string;
  data: ArrayBuffer | Buffer | Uint8Array | number[];
}

// Citation tracking (matches Claude's citation_start_delta/citation_end_delta)
export interface Citation {
  uuid: string;
  start_index: number;
  end_index?: number;
  url?: string;
  title?: string;
  source_type?: string;
}

// Content block state tracking - matches Claude's block types exactly
export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  index: number;
  // Text blocks
  text?: string;
  citations?: Citation[];
  flags?: string[];
  // Thinking blocks
  thinking?: string;
  summaries?: Array<{ summary: string } | string>;
  cut_off?: boolean;
  start_timestamp?: string;
  stop_timestamp?: string;
  // Tool use blocks
  name?: string;
  partial_json?: string;
  buffered_input?: string;
  approval_key?: string;
  // Tool result blocks
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
  // Legacy compatibility
  toolName?: string;
  toolInput?: string;
  toolMessage?: string;
  toolResult?: unknown;
  isError?: boolean;
  thinkingText?: string;
  thinkingSummary?: string;
}

// Step type for message-complete event timeline
export interface Step {
  type: 'thinking' | 'tool' | 'text';
  index: number;
  // Thinking
  thinkingText?: string;
  thinkingSummary?: string;
  summaries?: Array<{ summary: string } | string>;
  cut_off?: boolean;
  start_timestamp?: string;
  stop_timestamp?: string;
  // Tool
  toolName?: string;
  toolInput?: string;
  toolMessage?: string;
  toolResult?: unknown;
  isError?: boolean;
  // Text
  text?: string;
  citations?: Citation[];
  flags?: string[];
}

// Web search result from tool_result display_content
export interface WebSearchResult {
  type: string;
  title: string;
  url: string;
  metadata?: {
    site_domain?: string;
    favicon_url?: string;
    site_name?: string;
  };
}

// API response types
export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  stream?: NodeJS.ReadableStream;
}

export interface ConversationData {
  uuid: string;
  name?: string;
  model?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateConversationResponse extends ConversationData {
  conversationId: string;
  parentMessageUuid: string;
}
