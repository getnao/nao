import z from 'zod/v3';

/** Recorded in the previous onboarding conversation when the user restarts from the interface. */
export const RESTARTED_MESSAGE = 'I restarted the onboarding.';

export const InputSchema = z.object({});

export const OutputSchema = z.object({
	_version: z.literal('1').optional(),
	cancelledWarehouseSetup: z.boolean(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
