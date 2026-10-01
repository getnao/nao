import z from 'zod/v3';

export const InputSchema = z.object({
	description: z.string().describe('What the script does in 3 to 6 words, shown to the user while it runs.'),
	code: z
		.string()
		.describe(
			'Raw JavaScript, run as the body of an async function: top-level `await` and `return` work. Not JSON, not wrapped in markdown fences.',
		),
});

export const CallSchema = z.object({
	name: z.string().describe('Path of the called function, e.g. `mcp.linear.get_ticket`.'),
	status: z.enum(['ok', 'error', 'cancelled']),
	durationMs: z.number(),
	error: z.string().optional(),
});

export const ErrorSchema = z.object({
	kind: z.enum(['script', 'timeout', 'aborted', 'sandbox']),
	message: z.string(),
	stack: z.string().optional(),
});

export const OutputSchema = z.object({
	ok: z.boolean(),
	logs: z.array(z.string()).describe('Console output, in order, truncated past the output budget.'),
	result: z.string().optional().describe('JSON of the returned value, truncated past the output budget.'),
	error: ErrorSchema.optional(),
	calls: z.array(CallSchema),
	durationMs: z.number(),
	mcpAuthRequired: z.literal(true).optional().describe('Set when a call needs the user to connect `server`.'),
	server: z.string().optional(),
});

export type Input = z.infer<typeof InputSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type Call = z.infer<typeof CallSchema>;
