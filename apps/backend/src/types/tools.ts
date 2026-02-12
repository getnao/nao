import { tool } from 'ai';
import type { z } from 'zod/v3';

type ZodSchema = z.ZodTypeAny;

export interface ToolContext {
	projectPath?: string;
}

export interface ToolDefinition<TInput extends ZodSchema, TOutput extends ZodSchema> {
	description: string;
	inputSchema: TInput;
	outputSchema: TOutput;
	execute: (input: z.infer<TInput>, context: ToolContext) => Promise<z.infer<TOutput>>;
}

export function createTool<TInput extends ZodSchema, TOutput extends ZodSchema>(
	definition: ToolDefinition<TInput, TOutput>,
) {
	return tool({
		description: definition.description,
		inputSchema: definition.inputSchema,
		outputSchema: definition.outputSchema,
		execute: async (input, { experimental_context }) => {
			const context = (experimental_context as ToolContext) ?? {};
			return definition.execute(input, context);
		},
	});
}
