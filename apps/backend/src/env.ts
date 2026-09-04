import crypto from 'node:crypto';
import path from 'node:path';

import { isLlmProvider, LLM_PROVIDERS, NAMED_PROVIDER_KIND } from '@nao/shared/types';
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
	GITHUB_SSO: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
		.transform((val) => val === 'true'),

	GITLAB_CLIENT_ID: z.string().optional(),
	GITLAB_CLIENT_SECRET: z.string().optional(),
	GITLAB_ALLOWED_USERS: z.string().optional(),
	GITLAB_SSO: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
		.transform((val) => val === 'true'),
	GITLAB_BASE_URL: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined)
		.pipe(z.url({ message: 'GITLAB_BASE_URL must be a valid URL' }).optional()),
	GITLAB_REDIRECT_URI: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined)
		.pipe(z.url({ message: 'GITLAB_REDIRECT_URI must be a valid URL' }).optional()),

	AZURE_AD_CLIENT_ID: z.string().optional(),
	AZURE_AD_CLIENT_SECRET: z.string().optional(),
	AZURE_AD_TENANT_ID: z.string().optional(),
	AZURE_AD_TOKEN_SCOPE: z.string().optional(),

	ENABLE_USER_LOGIN: z
		.enum(['true', 'false'])
		.optional()
		.default('true')
		.transform((val) => val === 'true'),
	ENABLE_USER_SIGNUP: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
		.transform((val) => val === 'true'),

	DEFAULT_USER_ROLE: z.enum(['admin', 'user', 'viewer']).default('user'),

	OIDC_PROVIDER_ID: z.string().optional(),
	OIDC_PROVIDER_NAME: z.string().optional(),
	OIDC_DISCOVERY_URL: z.string().optional(),
	OIDC_CLIENT_ID: z.string().optional(),
	OIDC_CLIENT_SECRET: z.string().optional(),
	OIDC_SCOPES: z.string().optional(),
	OIDC_AUTH_DOMAINS: z.string().optional(),
	OIDC_PKCE: z.string().optional(),
	OIDC_GROUPS_CLAIM: z.string().optional(),
	OIDC_GROUP_ROLE_MAPPING: z.string().optional(),
	SSO_SESSION_MAX_AGE: z.coerce.number().int().positive().optional(),

	SMTP_PASSWORD: z.string().optional(),
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: z.string().optional(),
	SMTP_USER: z.string().optional(),
	SMTP_MAIL_FROM: z.string().optional(),
	SMTP_SSL: z.enum(['true', 'false']).optional(),

	FASTAPI_PORT: z.coerce.number().default(8005),
	APP_VERSION: z.string().default('dev'),
	APP_COMMIT: z.string().default('unknown'),
	APP_BUILD_DATE: z.string().default(''),

	NAO_DEFAULT_PROJECT_PATH: z.string().optional(),
	NAO_MODE: z.enum(['self-hosted', 'cloud']).default('self-hosted'),
	NAO_PROJECTS_DIR: z.string().default('./projects'),
	NAO_MCP_SCRATCH_DIR: z.string().optional(),
	NAO_CORE_VERSION: z.string().optional(),
	NAO_CONTEXT_SOURCE: z.enum(['local', 'git', 'api']).optional(),
	NAO_CONTEXT_GIT_URL: z.string().optional(),
	NAO_CONTEXT_GIT_BRANCH: z.string().optional(),
	NAO_CONTEXT_GIT_SUBPATH: z.string().optional(),
	NAO_CONTEXT_GIT_TOKEN: z.string().optional(),
	NAO_CONTEXT_GIT_SSH_KEY: z.string().optional(),
	NAO_CONTEXT_GIT_PLATFORM: z.enum(['github', 'gitlab', 'bitbucket']).optional(),

	NAO_STORAGE_BACKEND: z.enum(['none', 'local', 's3']).default('local'),
	NAO_STORAGE_LOCAL_PATH: z.string().default('./storage'),
	NAO_STORAGE_S3_BUCKET: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	NAO_STORAGE_S3_REGION: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	NAO_STORAGE_S3_ENDPOINT: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined)
		.pipe(z.url({ message: 'NAO_STORAGE_S3_ENDPOINT must be a valid URL' }).optional()),
	NAO_STORAGE_S3_PREFIX: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	NAO_STORAGE_S3_ACCESS_KEY_ID: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	NAO_STORAGE_S3_SECRET_ACCESS_KEY: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	NAO_STORAGE_S3_FORCE_PATH_STYLE: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
		.transform((val) => val === 'true'),
	NAO_STORAGE_MAX_FILE_SIZE_MB: z.coerce
		.number({ message: 'NAO_STORAGE_MAX_FILE_SIZE_MB must be a number of megabytes' })
		.positive({ message: 'NAO_STORAGE_MAX_FILE_SIZE_MB must be greater than 0' })
		.default(10),

	/**
	 * Where DuckDB extensions were pre-installed at image build time. Set so that spreadsheet
	 * support works with no network at query time, since the query runs with external access off.
	 */
	DUCKDB_EXTENSION_DIR: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),

	NAO_LICENSE: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),

	/**
	 * Default for the MCP endpoint toggle (Settings > MCP Endpoint) while a project has no stored
	 * settings — lets a deployment come up with the endpoint already enabled. Once an admin saves
	 * the settings, the stored value wins and this is ignored.
	 */
	MCP_ENDPOINT_ENABLED: z
		.enum(['true', 'false'])
		.optional()
		.transform((val) => (val === undefined ? undefined : val === 'true')),

	/**
	 * Public base URL external MCP clients connect to, when it differs from BETTER_AUTH_URL — e.g.
	 * a deployment that serves the MCP endpoint on an internet-facing host while the UI stays on a
	 * private/VPN-only host. Its `/mcp` URL is added to the OAuth token audiences, and the
	 * protected-resource metadata + WWW-Authenticate header advertise whichever host the client
	 * used. Leave unset for single-host deployments.
	 */
	MCP_PUBLIC_URL: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined)
		.pipe(z.url({ message: 'MCP_PUBLIC_URL must be a valid URL' }).optional()),

	POSTHOG_KEY: z.string().optional(),
	POSTHOG_HOST: z.url({ message: 'POSTHOG_HOST must be a valid URL' }).optional(),
	POSTHOG_DISABLED: z
		.enum(['true', 'false'])
		.optional()
		.transform((val) => val === 'true'),

	/**
	 * Comma-separated providers to keep out of the deployment entirely, regardless of where their
	 * credentials come from. Ambient credentials otherwise auto-register providers — e.g. EKS IRSA
	 * sets AWS_WEB_IDENTITY_TOKEN_FILE on every pod, which surfaces Bedrock even when the role has
	 * no Bedrock permissions. Accepts provider kinds and named instances (openaiCompatible/name).
	 */
	DISABLED_PROVIDERS: z
		.string()
		.optional()
		.transform((val) =>
			(val ?? '')
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean),
		)
		.refine((providers) => providers.every(isLlmProvider), {
			message: `DISABLED_PROVIDERS must be a comma-separated list of provider kinds (${LLM_PROVIDERS.join(', ')}) or named instances (${NAMED_PROVIDER_KIND}/<name>)`,
		}),

	LANGFUSE_PUBLIC_KEY: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	LANGFUSE_SECRET_KEY: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined),
	LANGFUSE_BASE_URL: z
		.string()
		.optional()
		.transform((val) => val?.trim() || undefined)
		.pipe(z.url({ message: 'LANGFUSE_BASE_URL must be a valid URL' }).optional()),

	BETA_AUTOMATIONS_ENABLED: z
		.enum(['true', 'false'])
		.optional()
		.default('true')
		.transform((val) => val === 'true'),

	BETA_CONTEXT_RECOMMENDATIONS_ENABLED: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
		.transform((val) => val === 'true'),

	BETA_STORY_FILTERS_ENABLED: z
		.enum(['true', 'false'])
		.optional()
		.default('false')
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

if (result.data.NAO_STORAGE_BACKEND === 's3' && !result.data.NAO_STORAGE_S3_BUCKET) {
	console.error('NAO_STORAGE_S3_BUCKET is required when NAO_STORAGE_BACKEND=s3.');
	process.exit(1);
}

export const env = result.data;

/**
 * TEST ONLY — re-parse `process.env` into the exported `env` object so tests
 * that mutate env vars between cases can observe the new values. Callers who
 * imported `env` keep seeing the live object because we mutate in place
 * rather than reassign.
 */
export function __reloadEnvForTesting(): void {
	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		throw new Error(`Invalid env during test reload: ${parsed.error.message}`);
	}
	// Clear first: zod omits optional keys from its output when the input is
	// absent, so a bare Object.assign would leave the previous value in place.
	const mutable = env as Record<string, unknown>;
	for (const key of Object.keys(mutable)) {
		delete mutable[key];
	}
	Object.assign(env, parsed.data);
}

export const isCloud = env.NAO_MODE === 'cloud';
export const isSelfHosted = env.NAO_MODE === 'self-hosted';

const normalizedBaseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, '');
export const MCP_SERVER_URL = `${normalizedBaseUrl}/mcp`;

const normalizedMcpPublicUrl = env.MCP_PUBLIC_URL?.replace(/\/+$/, '');
/** The `/mcp` URL on the public host, when MCP_PUBLIC_URL is set. */
export const MCP_PUBLIC_SERVER_URL = normalizedMcpPublicUrl ? `${normalizedMcpPublicUrl}/mcp` : undefined;
/** OAuth resource identifiers the token endpoint accepts (RFC 8707 audiences). */
export const MCP_VALID_AUDIENCES = [
	env.BETTER_AUTH_URL,
	MCP_SERVER_URL,
	...(MCP_PUBLIC_SERVER_URL ? [MCP_PUBLIC_SERVER_URL] : []),
];
/** Audiences a bearer token may carry to call /mcp — the MCP resource URLs, on either host. */
export const MCP_TOKEN_AUDIENCES = [MCP_SERVER_URL, ...(MCP_PUBLIC_SERVER_URL ? [MCP_PUBLIC_SERVER_URL] : [])];

// URL normalizes host to lowercase; compare request hosts case-insensitively to match.
const mcpPublicHost = normalizedMcpPublicUrl ? new URL(normalizedMcpPublicUrl).host : undefined;

/**
 * The origin a client is talking to, so the protected-resource metadata and WWW-Authenticate
 * header advertise the host actually in use. Returns the public MCP origin when the request came in
 * on it, else BETTER_AUTH_URL — never an arbitrary Host header, so only known origins are advertised.
 */
export function resolveMcpFacingOrigin(requestHost: string | undefined): string {
	if (normalizedMcpPublicUrl && requestHost && requestHost.toLowerCase() === mcpPublicHost) {
		return normalizedMcpPublicUrl;
	}
	return normalizedBaseUrl;
}

export function noProjectMessage(): string {
	return isCloud
		? 'No project configured. Create a project or ask your organization admin to add you to one.'
		: 'No project configured. Set NAO_DEFAULT_PROJECT_PATH environment variable.';
}
