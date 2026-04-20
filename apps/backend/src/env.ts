import crypto from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import { z } from 'zod/v4';

// Loads .env file at the root of the repository
dotenv.config({
	path: path.join(process.cwd(), '..', '..', '.env'),
});

const envSchema = z.object({
	MODE: z.enum(['dev', 'prod', 'test']).default('dev'),

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
	BETTER_AUTH_SECRET: z.string().min(20).default(crypto.randomBytes(32).toString('hex')),
	REDIS_URL: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),

	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GOOGLE_AUTH_DOMAINS: z.string().optional(),

	GITHUB_CLIENT_ID: z.string().optional(),
	GITHUB_CLIENT_SECRET: z.string().optional(),
	GITHUB_ALLOWED_USERS: z.string().optional(),
	CLOUD_GITHUB_CLIENT_ID: z.string().optional(),
	CLOUD_GITHUB_CLIENT_SECRET: z.string().optional(),
	DEFAULT_USER_ROLE: z.enum(['admin', 'user']).default('user'),

	SMTP_PASSWORD: z.string().optional(),
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: z.string().optional(),
	SMTP_MAIL_FROM: z.string().optional(),
	SMTP_SSL: z.enum(['true', 'false']).optional(),

	FASTAPI_PORT: z.coerce.number().default(8005),
	APP_VERSION: z.string().default('dev'),
	APP_COMMIT: z.string().default('unknown'),
	APP_BUILD_DATE: z.string().default(''),

	NAO_DEFAULT_PROJECT_PATH: z.string().optional(),
	NAO_MODE: z.enum(['self-hosted', 'cloud']).default('self-hosted'),
	NAO_PROJECTS_DIR: z.string().default('./projects'),
	NAO_CORE_VERSION: z.string().optional(),

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
		console.error(`${path}: ${issue.message}`);
	}
	process.exit(1);
}

if (result.data.NAO_DEFAULT_PROJECT_PATH && result.data.NAO_MODE === 'cloud') {
	console.error('NAO_DEFAULT_PROJECT_PATH and NAO_MODE=cloud cannot be set at the same time.');
	process.exit(1);
}

export const env = result.data;

export const isCloud = env.NAO_MODE === 'cloud';
export const isSelfHosted = env.NAO_MODE === 'self-hosted';

export function noProjectMessage(): string {
	return isCloud
		? 'No project configured. Create a project or ask your organization admin to add you to one.'
		: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.';
}
