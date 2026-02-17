import { z } from 'zod';

export interface McpServerConfig {
	type?: 'http';
	url?: URL;

	// For stdio transport
	command?: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpServerState {
	tools: Array<{
		name: string;
		description?: string;
		input_schema: unknown;
		enabled: boolean;
	}>;
	error?: string;
}

export const mcpJsonSchema = z.object({
	mcpServers: z.record(
		z.string(),
		z.object({
			type: z.enum(['http']).optional(),
			url: z
				.string()
				.url()
				.optional()
				.transform((val) => (val ? new URL(val) : undefined)),
			command: z.string().optional(),
			args: z.array(z.string()).optional(),
			env: z.record(z.string(), z.string()).optional(),
		}),
	),
});
