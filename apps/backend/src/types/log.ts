import { z } from 'zod/v4';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ['http', 'agent', 'tool', 'system'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const logFilterSchema = z.object({
	level: z.enum(LOG_LEVELS).optional(),
	source: z.enum(LOG_SOURCES).optional(),
	limit: z.number().int().min(1).max(500).default(100),
});
export type LogFilter = z.infer<typeof logFilterSchema>;
