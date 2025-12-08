import { net, session } from 'electron';
import Store from 'electron-store';
import crypto from 'crypto';
import type { StoreSchema, ApiResponse, AttachmentPayload, UploadFilePayload } from '../types';

const BASE_URL = 'https://claude.ai';

// Store instance
const store = new Store<StoreSchema>() as Store<StoreSchema> & {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
  clear(): void;
};

// Generate stable device/anonymous IDs
export function getDeviceId(): string {
  let deviceId = store.get('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    store.set('deviceId', deviceId);
  }
  return deviceId;
}

export function getAnonymousId(): string {
  let anonId = store.get('anonymousId');
  if (!anonId) {
    anonId = `claudeai.v1.${crypto.randomUUID()}`;
    store.set('anonymousId', anonId);
  }
  return anonId;
}

// Convert various binary inputs to a Node.js Buffer
function toBuffer(data: UploadFilePayload['data']): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(data);
}

// Normalize upload response into AttachmentPayload
function normalizeAttachmentResponse(data: any, fallback: UploadFilePayload): AttachmentPayload {
  const doc = data?.document || data || {};
  const documentId = doc.document_id || doc.file_uuid || doc.uuid || doc.id || doc.file_id;
  const fileUrl =
    doc.file_url ||
    doc.preview_url ||
    doc.thumbnail_url ||
    doc.url ||
    data?.download_url;

  if (!documentId) {
    throw new Error('Upload response missing document identifier');
  }

  const normalizedUrl = fileUrl
    ? (fileUrl.startsWith('http') ? fileUrl : `${BASE_URL}${fileUrl}`)
    : undefined;

  return {
    document_id: documentId,
    file_name: doc.file_name || doc.fileName || fallback.name,
    file_size: doc.size_bytes || doc.file_size || doc.fileSize || fallback.size,
    file_type: doc.file_type || doc.mime_type || doc.fileType || doc.file_kind || fallback.type || 'application/octet-stream',
    file_url: normalizedUrl,
    extracted_content: doc.extracted_content || doc.extract || doc.extracted_text
  };
}

// Upload a single attachment and normalize the response
export async function prepareAttachmentPayload(file: UploadFilePayload): Promise<AttachmentPayload> {
  const orgId = await getOrgId();
  if (!orgId) {
    throw new Error('Not authenticated');
  }

  const boundary = '----ElectronFormBoundary' + crypto.randomBytes(16).toString('hex');
  const fileBuffer = toBuffer(file.data);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`),
    Buffer.from(`Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const request = net.request({
      url: `${BASE_URL}/api/${orgId}/upload`,
      method: 'POST',
      useSessionCookies: true,
    });

    request.setHeader('accept', '*/*');
    request.setHeader('content-type', `multipart/form-data; boundary=${boundary}`);
    request.setHeader('origin', BASE_URL);
    request.setHeader('referer', `${BASE_URL}/new`);
    request.setHeader('anthropic-client-platform', 'web_claude_ai');
    request.setHeader('anthropic-device-id', getDeviceId());
    request.setHeader('anthropic-anonymous-id', getAnonymousId());
    request.setHeader(
      'user-agent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    let responseData = '';
    let statusCode = 0;

    request.on('response', (response) => {
      statusCode = response.statusCode;

      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : null;
          if (statusCode !== 200) {
            reject(new Error(`Upload failed: ${statusCode} - ${responseData}`));
            return;
          }
          const attachment = normalizeAttachmentResponse(parsed, file);
          console.log(`[API] Uploaded attachment: ${attachment.file_name} (${attachment.file_size} bytes)`);
          resolve(attachment);
        } catch (err) {
          reject(new Error(`Upload parse failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(body);
    request.end();
  });
}

// Check if we have valid session cookies
export async function isAuthenticated(): Promise<boolean> {
  const cookies = await session.defaultSession.cookies.get({ domain: '.claude.ai' });
  const sessionKey = cookies.find(c => c.name === 'sessionKey')?.value;
  const orgId = cookies.find(c => c.name === 'lastActiveOrg')?.value;
  return !!(sessionKey && orgId);
}

// Get org ID from cookies
export async function getOrgId(): Promise<string | null> {
  const cookies = await session.defaultSession.cookies.get({ domain: '.claude.ai' });
  return cookies.find(c => c.name === 'lastActiveOrg')?.value || null;
}

// Set common headers on a request
function setCommonHeaders(request: Electron.ClientRequest): void {
  request.setHeader('accept', 'application/json, text/event-stream');
  request.setHeader('content-type', 'application/json');
  request.setHeader('origin', BASE_URL);
  request.setHeader('anthropic-client-platform', 'web_claude_ai');
  request.setHeader('anthropic-device-id', getDeviceId());
  request.setHeader('anthropic-anonymous-id', getAnonymousId());
  request.setHeader('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
}

// Make authenticated request using Electron net (includes session cookies)
export async function makeRequest(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: object
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method,
      useSessionCookies: true,
    });

    setCommonHeaders(request);

    let responseData = '';
    let statusCode = 0;

    request.on('response', (response) => {
      statusCode = response.statusCode;

      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      response.on('end', () => {
        try {
          const data = responseData ? JSON.parse(responseData) : null;
          resolve({ status: statusCode, data });
        } catch {
          resolve({ status: statusCode, data: responseData });
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

// Stream response for completion endpoint
export async function streamCompletion(
  orgId: string,
  conversationId: string,
  prompt: string,
  parentMessageUuid: string,
  onData: (chunk: string) => void,
  options: {
    attachments?: AttachmentPayload[];
    files?: Array<AttachmentPayload | string>;
    sync_sources?: unknown[];
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${conversationId}/completion`;

    const request = net.request({
      url,
      method: 'POST',
      useSessionCookies: true,
    });

    request.setHeader('accept', 'text/event-stream, text/event-stream');
    request.setHeader('accept-language', 'en-US,en;q=0.9');
    request.setHeader('content-type', 'application/json');
    request.setHeader('origin', BASE_URL);
    request.setHeader('referer', `${BASE_URL}/chat/${conversationId}`);
    request.setHeader('anthropic-client-platform', 'web_claude_ai');
    request.setHeader('anthropic-client-version', '1.0.0');
    request.setHeader('anthropic-device-id', getDeviceId());
    request.setHeader('anthropic-anonymous-id', getAnonymousId());
    request.setHeader('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const files = (options.files || []).map((file) => typeof file === 'string' ? file : file.document_id);

    const body = {
      prompt,
      parent_message_uuid: parentMessageUuid === conversationId ? null : parentMessageUuid,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      personalized_styles: [{
        type: 'default',
        key: 'Default',
        name: 'Normal',
        nameKey: 'normal_style_name',
        prompt: 'Normal',
        summary: 'Default responses from Claude',
        summaryKey: 'normal_style_summary',
        isDefault: true
      }],
      locale: 'en-US',
      tools: [
        { type: 'web_search_v0', name: 'web_search' },
        { type: 'artifacts_v0', name: 'artifacts' },
        { type: 'repl_v0', name: 'repl' }
      ],
      attachments: options.attachments || [],
      files,
      sync_sources: options.sync_sources || [],
      rendering_mode: 'messages'
    };

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        let errorData = '';
        response.on('data', (chunk) => { errorData += chunk.toString(); });
        response.on('end', () => {
          reject(new Error(`Completion failed: ${response.statusCode} - ${errorData}`));
        });
        return;
      }

      let buffer = '';
      response.on('data', (chunk) => {
        buffer += chunk.toString();
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            onData(line + '\n');
          }
        }
      });

      response.on('end', () => {
        resolve();
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.write(JSON.stringify(body));
    request.end();
  });
}

// Stop a streaming response
export async function stopResponse(
  orgId: string,
  conversationId: string
): Promise<void> {
  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${conversationId}/stop_response`;

  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: 'POST',
      useSessionCookies: true,
    });

    setCommonHeaders(request);

    request.on('response', (response) => {
      if (response.statusCode !== 200 && response.statusCode !== 204) {
        reject(new Error(`Stop response failed: ${response.statusCode}`));
        return;
      }
      resolve();
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

// Generate title for a conversation
export async function generateTitle(
  orgId: string,
  conversationId: string,
  messageContent: string,
  recentTitles: string[] = []
): Promise<{ title: string }> {
  const url = `${BASE_URL}/api/organizations/${orgId}/chat_conversations/${conversationId}/title`;
  const result = await makeRequest(url, 'POST', {
    message_content: messageContent,
    recent_titles: recentTitles
  });

  if (result.status !== 202) {
    throw new Error(`Failed to generate title: ${result.status}`);
  }

  return result.data as { title: string };
}

// Export store and BASE_URL for use in other modules
export { store, BASE_URL };
