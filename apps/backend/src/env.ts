import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod';

// Loads .env file at the root of the repository
dotenv.config({
	path: path.join(process.cwd(), '..', '..', '.env'),
});

const envSchema = z.object({
	MODE: z.enum(['dev', 'prod']).default('dev'),

	DB_URI: z.string().default('sqlite:./db.sqlite'),
	DB_SSL: z
		.enum(['true', 'false'])
		.optional()
		.transform((val) => val === 'true'),
	DB_QUERY_LOGGING: z
		.enum(['true', 'false'])
		.optional()
		.transform((val) => val === 'true'),

	BETTER_AUTH_URL: z.url({ message: 'BETTER_AUTH_URL must be a valid URL' }).default('http://localhost:5005/'),
	BETTER_AUTH_SECRET: z.string().min(20).or(z.literal('').optional()), // try to make min 1 if set and optional otherwise

	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GOOGLE_AUTH_DOMAINS: z.string().optional(),

	SLACK_BOT_TOKEN: z.string().optional(),
	SLACK_SIGNING_SECRET: z.string().optional(),

  FASTAPI_PORT: z.coerce.number().default(8005),

	NAO_DEFAULT_PROJECT_PATH: z.string().optional(),

	MCP_JSON_FILE_PATH: z.string().optional(),

	POSTHOG_KEY: z.string().optional(),
	POSTHOG_HOST: z.url({ message: 'POSTHOG_HOST must be a valid URL' }).optional(),
	POSTHOG_DISABLED: z
		.enum(['true', 'false'])
		.optional()
		.transform((val) => val === 'true'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
	for (const issue of result.error.issues) {
		const path = issue.path.join('.');
		console.log(`${path}: ${issue.message}`);
	}
	process.exit(1);
}

export const env = result.data;
