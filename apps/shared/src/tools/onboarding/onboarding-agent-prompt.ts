import z from 'zod/v3';

export const InputSchema = z.object({
	prompt: z
		.string()
		.min(1)
		.refine((prompt) => prompt.trim().length > 0)
		.describe('The exact prompt to display and make copyable for the user’s local coding agent.'),
});

export const OutputSchema = InputSchema.extend({
	_version: z.literal('1').optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
