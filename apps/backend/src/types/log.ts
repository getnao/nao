import { z } from 'zod/v4';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ['http', 'agent', 'tool', 'system', 'story'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** The kind of record a log is about, so the logs of one story (or any other object) can be read back. */
export const LOG_OBJECT_TYPES = ['story'] as const;
export type LogObjectType = (typeof LOG_OBJECT_TYPES)[number];

export interface LogObject {
	type: LogObjectType;
	id: string;
}

declare module 'fastify' {
	interface FastifyRequest {
		/** The user who made the request, recorded on its logs. For an API-key request, the user who created the key. */
		actorUserId?: string;
	}
}

export const logFilterSchema = z.object({
	level: z.enum(LOG_LEVELS).optional(),
	source: z.enum(LOG_SOURCES).optional(),
	limit: z.number().int().min(1).max(500).default(100),
	before: z.coerce.date().optional(),
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
});
export type LogFilter = z.infer<typeof logFilterSchema>;
