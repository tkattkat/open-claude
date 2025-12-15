import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { EventEmitter } from 'events';
import type { MCPServerConfig } from '../types';

// Tool type from SDK
interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPConnection {
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: MCPTool[];
  isConnected: boolean;
}

// Sanitize args by stripping surrounding quotes
function sanitizeArgs(args: string[]): string[] {
  return args.map(arg => {
    if ((arg.startsWith('"') && arg.endsWith('"')) ||
        (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg.slice(1, -1);
    }
    return arg;
  });
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

    try {
      let transport: StdioClientTransport | SSEClientTransport;

      // Check if this is an HTTP/SSE endpoint
      if (config.command.startsWith('http://') || config.command.startsWith('https://')) {
        // SSE transport for HTTP endpoints
        console.log(`[MCP ${config.name}] Using SSE transport: ${config.command}`);
        transport = new SSEClientTransport(new URL(config.command));
      } else {
        // Stdio transport for local commands
        const sanitizedArgs = sanitizeArgs(config.args || []);
        console.log(`[MCP ${config.name}] Using stdio transport`);
        console.log(`[MCP ${config.name}] Command: ${config.command}`);
        console.log(`[MCP ${config.name}] Args: ${JSON.stringify(sanitizedArgs)}`);

        transport = new StdioClientTransport({
          command: config.command,
          args: sanitizedArgs,
          env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
          stderr: 'pipe'
        });

        // Log stderr if available
        if (transport.stderr) {
          transport.stderr.on('data', (data: Buffer) => {
            const stderr = data.toString().trim();
            if (stderr) {
              console.log(`[MCP ${config.name}] stderr:`, stderr);
            }
          });
        }
      }

      // Create MCP client
      const client = new Client(
        { name: 'open-claude', version: '1.0.0' },
        { capabilities: { roots: { listChanged: true } } }
      );

      // Handle transport errors
      transport.onerror = (error) => {
        console.error(`[MCP ${config.name}] Transport error:`, error);
        this.emit('error', config.id, error);
      };

      transport.onclose = () => {
        console.log(`[MCP ${config.name}] Transport closed`);
        const conn = this.connections.get(config.id);
        if (conn) {
          conn.isConnected = false;
        }
        this.emit('disconnected', config.id);
      };

      // Connect to server
      await client.connect(transport);

      // Get available tools
      const toolsResult = await client.listTools();
      const tools: MCPTool[] = toolsResult.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));

      const connection: MCPConnection = {
        config,
        client,
        transport,
        tools,
        isConnected: true
      };

      this.connections.set(config.id, connection);

      console.log(`[MCP ${config.name}] Connected with ${tools.length} tools`);
      this.emit('connected', config.id, tools);

      return tools;
    } catch (error) {
      console.error(`[MCP ${config.name}] Failed to connect:`, error);
      await this.disconnect(config.id);
      throw error;
    }
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.isConnected) {
      throw new Error(`Server ${serverId} is not connected`);
    }

    const result = await connection.client.callTool({
      name: toolName,
      arguments: args
    });

    return result;
  }

  async disconnect(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId);
    if (!connection) return;

    try {
      await connection.transport.close();
    } catch (e) {
      console.error(`[MCP ${connection.config.name}] Error closing transport:`, e);
    }

    connection.isConnected = false;
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
