import type { ToolResultOutput } from '@ai-sdk/provider-utils';
import { tool } from 'ai';
import type { z } from 'zod/v3';

type ZodSchema = z.ZodTypeAny;

export interface ToolContext {
	projectFolder: string;
}

export interface ToolDefinition<TInput extends ZodSchema, TOutput extends ZodSchema> {
	description: string;
	inputSchema: TInput;
	outputSchema: TOutput;
	execute: (input: z.infer<TInput>, context: ToolContext) => Promise<z.infer<TOutput>>;
	toModelOutput?: (params: { output: z.infer<TOutput> }) => ToolResultOutput;
}

export function createTool<TInput extends ZodSchema, TOutput extends ZodSchema>(
	definition: ToolDefinition<TInput, TOutput>,
) {
	return tool({
		description: definition.description,
		inputSchema: definition.inputSchema,
		outputSchema: definition.outputSchema,
		execute: async (input, { experimental_context }) => {
			const context = experimental_context as ToolContext;
			return definition.execute(input, context);
		},
		...(definition.toModelOutput && { toModelOutput: definition.toModelOutput }),
	});
}
