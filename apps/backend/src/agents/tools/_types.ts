import { tool } from 'ai';
import type { z } from 'zod/v3';

type ZodSchema = z.ZodTypeAny;

export interface ToolDefinition<TInput extends ZodSchema, TOutput extends ZodSchema> {
	name: string;
	description: string;
	inputSchema: TInput;
	outputSchema: TOutput;
	execute: (input: z.infer<TInput>) => Promise<z.infer<TOutput>>;
}

/**
 * Creates a tool with consistent structure.
 * Schemas are exported separately from each tool's schema.ts file.
 */
export function createTool<TInput extends ZodSchema, TOutput extends ZodSchema>(
	definition: ToolDefinition<TInput, TOutput>,
) {
	return {
		tool: tool({
			description: definition.description,
			inputSchema: definition.inputSchema,
			outputSchema: definition.outputSchema,
			execute: definition.execute,
		}),
	};
}
