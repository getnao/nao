import z from 'zod/v3';

export const SUBAGENT_NAMES = ['search'] as const;

export type SubagentName = (typeof SUBAGENT_NAMES)[number];

export const SUBAGENT_LABELS: Record<SubagentName, string> = {
	search: 'Context search',
};

export const InputSchema = z.object({
	subagent: z.enum(SUBAGENT_NAMES).describe('The subagent to delegate the task to.'),
	prompt: z
		.string()
		.describe(
			'The task, written to be self-contained: the subagent sees none of this conversation, so restate every name, filter and constraint it needs.',
		),
	model_id: z
		.string()
		.optional()
		.describe(
			'Only when the user explicitly asked for a specific model to run this task. Omit otherwise: the project settings decide.',
		),
});

export const StepSchema = z.object({
	tool: z.string(),
	summary: z.string(),
	status: z.enum(['running', 'done', 'error']),
});

export const OutputSchema = z.object({
	_version: z.literal('1'),
	status: z.enum(['running', 'completed']),
	model: z.string(),
	startedAt: z.number().describe('Epoch milliseconds the run started at.'),
	durationMs: z.number().optional().describe('Set once the run has completed.'),
	steps: z.array(StepSchema),
	report: z.string(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type Step = z.infer<typeof StepSchema>;
