import z from 'zod/v3';

export const description =
	'Suggest follow-up messages the user might want to send next. This should be the last tool you call and should only be called once per turn. Most of your responses should end with follow-ups suggested via this tool.';

export const inputSchema = z.object({
	suggestions: z
		.array(z.string().describe('A concise follow-up question or message the user might want to send.'))
		.min(1)
		.max(3)
		.describe('List of 1-3 suggested follow-up messages.'),
});

export const outputSchema = z.object({
	success: z.literal(true),
});

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
