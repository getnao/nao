import z from 'zod/v3';

export const InputSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe(
			'A single, focused question to ask the user. Keep it short, specific, and actionable. Ask only one thing at a time.',
		),
	options: z
		.array(
			z
				.string()
				.describe('A short, distinct candidate answer the user can pick with one click. Keep under ~60 chars.'),
		)
		.min(2)
		.max(5)
		.optional()
		.describe(
			'Optional 2-5 mutually exclusive answer choices. Provide options whenever the answer is naturally enumerable; omit when the question is open-ended.',
		),
});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	success: z.literal(true),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
