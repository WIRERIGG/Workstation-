import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// Simple MCP server without authentication
export class SimpleMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "Simple Test MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Register a simple test tool
		this.server.tool(
			"hello",
			"A simple hello world tool",
			{
				name: z.string().describe("Your name"),
			},
			async ({ name }) => {
				return {
					content: [
						{
							type: "text",
							text: `Hello, ${name}! This is a test MCP server running successfully.`,
						},
					],
				};
			}
		);

		// Register a math tool
		this.server.tool(
			"add",
			"Add two numbers",
			{
				a: z.number().describe("First number"),
				b: z.number().describe("Second number"),
			},
			async ({ a, b }) => {
				const result = a + b;
				return {
					content: [
						{
							type: "text",
							text: `${a} + ${b} = ${result}`,
						},
					],
				};
			}
		);

		// Register a system info tool
		this.server.tool(
			"systemInfo",
			"Get system information",
			{},
			async () => {
				return {
					content: [
						{
							type: "text",
							text: `**System Information**\n\nServer: Simple MCP Test Server\nVersion: 1.0.0\nEnvironment: ${this.env.NODE_ENV || 'development'}\nTimestamp: ${new Date().toISOString()}`,
						},
					],
				};
			}
		);

		console.log("Simple MCP server initialized with 3 tools: hello, add, systemInfo");
	}
}

// Export the handler directly without OAuth
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		
		// Log the request
		console.log(`Request received: ${request.method} ${url.pathname}`);

		// Handle MCP endpoints
		if (url.pathname === "/mcp") {
			return SimpleMCP.serve("/mcp")(request, env, {} as any);
		}
		
		if (url.pathname === "/sse") {
			return SimpleMCP.serveSSE("/sse")(request, env, {} as any);
		}

		// Return basic info for root path
		if (url.pathname === "/") {
			return new Response(JSON.stringify({
				name: "Simple MCP Test Server",
				version: "1.0.0",
				endpoints: {
					mcp: "/mcp",
					sse: "/sse"
				},
				tools: ["hello", "add", "systemInfo"]
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}

		return new Response("Not Found", { status: 404 });
	}
};