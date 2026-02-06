import z from 'zod/v3';

export const InputSchema = z.object({
	suggestions: z
		.array(z.string().describe('A concise follow-up question or message the user might want to send.'))
		.min(1)
		.max(3)
		.describe('List of 1-3 suggested follow-up messages.'),
});

export const OutputSchema = z.object({
	success: z.literal(true),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
