import z from 'zod/v3';

export const FlowSchema = z.enum(['new', 'local', 'github', 'database']);

export type Flow = z.infer<typeof FlowSchema>;

const MAX_STEP_BY_FLOW: Record<Flow, number> = {
	new: 4,
	local: 4,
	github: 2,
	database: 2,
};

const InputObjectSchema = z.object({
	flow: FlowSchema.describe('The onboarding path selected by the user.'),
	step: z.number().int().min(0).max(4).describe('The number of completed steps in the selected flow.'),
});

const validateStepForFlow = (input: z.infer<typeof InputObjectSchema>, context: z.RefinementCtx) => {
	const maximum = MAX_STEP_BY_FLOW[input.flow];
	if (input.step > maximum) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['step'],
			message: `${input.flow} onboarding only supports steps 0-${maximum}`,
		});
	}
};

export const InputSchema = InputObjectSchema.superRefine(validateStepForFlow);

export const OutputSchema = InputObjectSchema.extend({
	_version: z.literal('1').optional(),
}).superRefine(validateStepForFlow);

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
