import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { MCPServerConfig } from '../types';

// MCP Protocol Types
interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPServerInfo {
  name: string;
  version: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPConnection {
  config: MCPServerConfig;
  process: ChildProcess | null;
  tools: MCPTool[];
  serverInfo: MCPServerInfo | null;
  isConnected: boolean;
  pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  requestId: number;
  buffer: string;
}

class MCPClient extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map();

  async connect(config: MCPServerConfig): Promise<MCPTool[]> {
    if (!config.enabled) {
      console.log(`[MCP] Server ${config.name} is disabled, skipping connection`);
      return [];
    }

    // Disconnect if already connected
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    console.log(`[MCP] Connecting to server: ${config.name}`);

    const connection: MCPConnection = {
      config,
      process: null,
      tools: [],
      serverInfo: null,
      isConnected: false,
      pendingRequests: new Map(),
      requestId: 0,
      buffer: ''
    };

    try {
      // Spawn the MCP server process
      const env = { ...process.env, ...config.env };
      const proc = spawn(config.command, config.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      });

      connection.process = proc;

      // Handle stdout (JSON-RPC responses)
      proc.stdout?.on('data', (data: Buffer) => {
        this.handleData(config.id, data);
      });

      // Handle stderr (logging)
      proc.stderr?.on('data', (data: Buffer) => {
        console.log(`[MCP ${config.name}] stderr:`, data.toString());
      });

      // Handle process exit
      proc.on('exit', (code) => {
        console.log(`[MCP ${config.name}] Process exited with code ${code}`);
        connection.isConnected = false;
        this.emit('disconnected', config.id);
      });

      proc.on('error', (error) => {
        console.error(`[MCP ${config.name}] Process error:`, error);
        connection.isConnected = false;
        this.emit('error', config.id, error);
      });

      this.connections.set(config.id, connection);

      // Initialize connection with MCP protocol
      await this.initialize(config.id);

      // Get available tools
      const tools = await this.listTools(config.id);
      connection.tools = tools;
      connection.isConnected = true;

      console.log(`[MCP ${config.name}] Connected with ${tools.length} tools`);
      this.emit('connected', config.id, tools);

      return tools;
    } catch (error) {
      console.error(`[MCP ${config.name}] Failed to connect:`, error);
      await this.disconnect(config.id);
      throw error;
    }
  }

  private handleData(serverId: string, data: Buffer) {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    connection.buffer += data.toString();

    // Process complete JSON-RPC messages (delimited by newlines)
    const lines = connection.buffer.split('\n');
    connection.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JSONRPCResponse;
        this.handleResponse(serverId, message);
      } catch (e) {
        console.error(`[MCP ${connection.config.name}] Failed to parse response:`, e, line);
      }
    }
  }

  private handleResponse(serverId: string, response: JSONRPCResponse) {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    const pending = connection.pendingRequests.get(response.id);
    if (pending) {
      connection.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private async sendRequest(serverId: string, method: string, params?: unknown): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.process?.stdin) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const id = ++connection.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      connection.pendingRequests.set(id, { resolve, reject });

      const timeoutId = setTimeout(() => {
        connection.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 30000);

      connection.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      const message = JSON.stringify(request) + '\n';
      connection.process?.stdin?.write(message);
    });
  }

  private async initialize(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(`Server ${serverId} not found`);

    const result = await this.sendRequest(serverId, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: false }
      },
      clientInfo: {
        name: 'open-claude',
        version: '1.0.0'
      }
    }) as { serverInfo?: MCPServerInfo };

    connection.serverInfo = result?.serverInfo || null;

    // Send initialized notification
    await this.sendRequest(serverId, 'notifications/initialized', {});
  }

  private async listTools(serverId: string): Promise<MCPTool[]> {
    const result = await this.sendRequest(serverId, 'tools/list', {}) as { tools?: MCPTool[] };
    return result?.tools || [];
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest(serverId, 'tools/call', {
      name: toolName,
      arguments: args
    });
    return result;
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    if (connection.process) {
      connection.process.kill();
      connection.process = null;
    }

    connection.isConnected = false;
    connection.tools = [];
    this.connections.delete(serverId);

    console.log(`[MCP] Disconnected from server: ${connection.config.name}`);
  }

  async disconnectAll(): Promise<void> {
    for (const serverId of this.connections.keys()) {
      await this.disconnect(serverId);
    }
  }

  getConnection(serverId: string): MCPConnection | undefined {
    return this.connections.get(serverId);
  }

  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values());
  }

  getAllTools(): Array<{ serverId: string; serverName: string; tool: MCPTool }> {
    const allTools: Array<{ serverId: string; serverName: string; tool: MCPTool }> = [];

    for (const [serverId, connection] of this.connections) {
      if (!connection.isConnected) continue;

      for (const tool of connection.tools) {
        allTools.push({
          serverId,
          serverName: connection.config.name,
          tool
        });
      }
    }

    return allTools;
  }

  // Convert MCP tools to Claude API tool format
  getToolsForClaude(): Array<{
    name: string;
    description: string;
    input_schema: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }> {
    const tools: Array<{
      name: string;
      description: string;
      input_schema: {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }> = [];

    for (const { serverName, tool } of this.getAllTools()) {
      tools.push({
        name: `mcp_${serverName}_${tool.name}`,
        description: tool.description || `MCP tool: ${tool.name} from ${serverName}`,
        input_schema: tool.inputSchema || { type: 'object' }
      });
    }

    return tools;
  }
}

// Export a singleton instance
export const mcpClient = new MCPClient();
