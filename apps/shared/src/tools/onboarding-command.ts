import z from 'zod/v3';

export const InputSchema = z.object({
	command: z
		.string()
		.min(1)
		.refine((command) => command.trim().length > 0)
		.describe('The exact terminal command to display and make copyable.'),
});

export const OutputSchema = InputSchema.extend({
	_version: z.literal('1').optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
