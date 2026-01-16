import { z } from 'zod/v4';

export const SlackEventSchema = z.object({
	type: z.string(),
	user: z.string(),
	ts: z.string(),
	thread_ts: z.string().optional(),
	text: z.string(),
	channel: z.string(),
	event_ts: z.string(),
});

export const SlackRequestSchema = z.object({
	type: z.string().optional(),
	challenge: z.string().optional(),
	token: z.string().optional(),
	event: SlackEventSchema.optional(),
});

export type SlackRequest = z.infer<typeof SlackRequestSchema>;
export type SlackEvent = z.infer<typeof SlackEventSchema>;
