import type { ResourceServerMetadata } from '@better-auth/oauth-provider';
import {
	oauthProvider,
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import type { BetterAuthPlugin, Session } from 'better-auth';
import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { verifyAccessToken } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins/bearer';
import type { JWTPayload } from 'jose';

import type { User as DBUser } from './db/abstractSchema';
import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import { env, isCloud, MCP_VALID_AUDIENCES } from './env';
import * as accountQueries from './queries/account.queries';
import * as orgQueries from './queries/organization.queries';
import * as projectQueries from './queries/project.queries';
import * as slackConfigQueries from './queries/project-slack-config.queries';
import * as userQueries from './queries/user.queries';
import { emailService } from './services/email';
import { githubOAuthConfig } from './services/github';
import * as gitlabService from './services/gitlab';
import { hasFeature, LICENSE_FEATURES } from './services/license.service';
import {
	augmentSocialProvidersWithMicrosoft,
	getTrustedProvidersForMicrosoft,
	isSocialProviderMicrosoft,
} from './services/microsoft-auth.service';
import {
	augmentPluginsWithOidc,
	getOidcProviderId,
	getTrustedProvidersForOidc,
	isSocialProviderOidc,
} from './services/oidc-auth.service';
import { syncRolesFromSsoGroups } from './services/sso-group-mapping.service';
import { shouldExpireSsoSession } from './services/sso-session.service';
import { buildForgotPasswordEmail } from './utils/email-builders';
import { logger, serializeError } from './utils/logger';
import {
	buildEmailDomainAliases,
	buildUsernameAllowlist,
	isEmailDomainAllowed,
	resolveProviderId,
} from './utils/utils';

type MetadataHandler = (request: Request) => Promise<Response>;

let defaultAuthPromise: Promise<Awaited<ReturnType<typeof createAuthInstance>>> | null = null;
let authServerMetadataPromise: Promise<MetadataHandler> | null = null;
let openIdConfigMetadataPromise: Promise<MetadataHandler> | null = null;

export const getAuth = async () => {
	if (!defaultAuthPromise) {
		defaultAuthPromise = createAuthInstance(env.BETTER_AUTH_URL);
	}
	return defaultAuthPromise;
};

export const getSession = async (headers: Headers) => {
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers });
	if (!session?.session || !(await shouldExpireSsoSession(session.session))) {
		return session;
	}

	const context = await auth.$context;
	await context.internalAdapter.deleteSession(session.session.token);
	return null;
};

export function updateAuth() {
	defaultAuthPromise = null;
	authServerMetadataPromise = null;
	openIdConfigMetadataPromise = null;
}

export async function verifyOAuthAccessToken(token: string, audience: string[]): Promise<JWTPayload> {
	const { issuer, jwksUrl } = await getAuthServerEndpoints();
	return verifyAccessToken(token, {
		verifyOptions: { audience, issuer },
		jwksUrl,
	});
}

export async function buildProtectedResourceMetadata(
	overrides: ResourceServerMetadata,
): Promise<ResourceServerMetadata> {
	const { issuer } = await getAuthServerEndpoints();
	return {
		authorization_servers: [issuer],
		...overrides,
	};
}

export function getAuthServerMetadataHandler(): Promise<MetadataHandler> {
	if (!authServerMetadataPromise) {
		authServerMetadataPromise = getAuth().then(oauthProviderAuthServerMetadata);
	}
	return authServerMetadataPromise;
}

export function getOpenIdConfigMetadataHandler(): Promise<MetadataHandler> {
	if (!openIdConfigMetadataPromise) {
		openIdConfigMetadataPromise = getAuth().then(oauthProviderOpenIdConfigMetadata);
	}
	return openIdConfigMetadataPromise;
}

async function createAuthInstance(baseURL: string) {
	const githubAllowlist = buildUsernameAllowlist(env.GITHUB_ALLOWED_USERS);
	const gitlabAllowlist = buildUsernameAllowlist(env.GITLAB_ALLOWED_USERS);
	const disableEmailSignUp = await shouldDisableEmailSignUp();

	const ssoPlugins: BetterAuthPlugin[] = [];

	// Cloud uses a single deployment-level Google credential; self-hosted reads the
	// org-level credential (with env fallback) so existing instances keep working.
	const googleConfig = await orgQueries.getGoogleConfig();
	const googleClientId = isCloud ? env.GOOGLE_CLIENT_ID : googleConfig.clientId;
	const googleClientSecret = isCloud ? env.GOOGLE_CLIENT_SECRET : googleConfig.clientSecret;

	const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {};
	if (googleClientId && googleClientSecret) {
		socialProviders.google = {
			prompt: 'select_account',
			clientId: googleClientId,
			clientSecret: googleClientSecret,
		};
	}

	const githubConfig = env.GITHUB_SSO ? githubOAuthConfig() : null;
	if (githubConfig) {
		socialProviders.github = {
			clientId: githubConfig.clientId,
			clientSecret: githubConfig.clientSecret,
			getUserInfo: async (token) => {
				const res = await fetch('https://api.github.com/user', {
					headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
				});
				if (!res.ok) {
					throw new Error(`GitHub API error: ${res.status}`);
				}
				const profile = await res.json();
				const githubLogin = typeof profile.login === 'string' ? profile.login.toLowerCase() : undefined;

				if (githubAllowlist.size > 0 && (!githubLogin || !githubAllowlist.has(githubLogin))) {
					throw new APIError('FORBIDDEN', {
						message: 'Your GitHub account is not authorized to access this application.',
					});
				}

				return {
					user: {
						id: String(profile.id),
						name: profile.login as string,
						email: (profile.email ?? `${profile.login}@users.noreply.github.com`) as string,
						image: profile.avatar_url as string,
						emailVerified: true,
					},
					data: profile,
				};
			},
		};
	}

	const gitlabConfig = env.GITLAB_SSO ? gitlabService.gitlabOAuthConfig() : null;
	if (gitlabConfig) {
		socialProviders.gitlab = {
			clientId: gitlabConfig.clientId,
			clientSecret: gitlabConfig.clientSecret,
			issuer: gitlabService.gitlabBaseUrl(),
			getUserInfo: async (token) => {
				const profile = await gitlabService.getUser(token.accessToken!);
				const gitlabUsername =
					typeof profile.username === 'string' ? profile.username.toLowerCase() : undefined;

				if (gitlabAllowlist.size > 0 && (!gitlabUsername || !gitlabAllowlist.has(gitlabUsername))) {
					throw new APIError('FORBIDDEN', {
						message: 'Your GitLab account is not authorized to access this application.',
					});
				}

				const hostname = new URL(gitlabService.gitlabBaseUrl()).hostname;
				return {
					user: {
						id: String(profile.id),
						name: profile.name || profile.username,
						email: profile.email ?? `${profile.username}@users.noreply.${hostname}`,
						image: profile.avatar_url,
						emailVerified: true,
					},
					data: profile,
				};
			},
		};
	}

	const ssoEnabled = await hasFeature(LICENSE_FEATURES.sso);
	if (ssoEnabled) {
		augmentSocialProvidersWithMicrosoft(socialProviders);
		augmentPluginsWithOidc(ssoPlugins);
	}

	const trustedProviders = [
		'google',
		'github',
		'gitlab',
		...(ssoEnabled ? [...getTrustedProvidersForMicrosoft(), ...getTrustedProvidersForOidc()] : []),
	];

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		baseURL,
		basePath: '/api/auth',
		database: drizzleAdapter(db, {
			provider: dbConfig.dialect === Dialect.Postgres ? 'pg' : 'sqlite',
			schema: dbConfig.schema,
		}),
		plugins: [
			bearer(),
			jwt(),
			oauthProvider({
				loginPage: '/login',
				consentPage: '/consent',
				accessTokenExpiresIn: 86400,
				refreshTokenExpiresIn: 604800,
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
				validAudiences: MCP_VALID_AUDIENCES,
			}),
			...ssoPlugins,
		],
		trustedOrigins: baseURL ? [baseURL, ...(env.MODE === 'dev' ? ['http://localhost:3000'] : [])] : undefined,
		emailAndPassword: {
			enabled: env.ENABLE_USER_LOGIN === true,
			disableSignUp: disableEmailSignUp,
			sendResetPassword: async ({ user, url }) => {
				emailService.sendEmail(user.email, buildForgotPasswordEmail(user, url));
			},
		},
		socialProviders,
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders,
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== '/sign-up/email' || env.ENABLE_USER_LOGIN !== true) {
					return;
				}

				const body = (ctx.body ?? {}) as {
					email?: string;
					name?: string;
					password?: string;
					rememberMe?: boolean;
				};
				if (
					typeof body.email !== 'string' ||
					typeof body.name !== 'string' ||
					typeof body.password !== 'string'
				) {
					return;
				}

				const normalizedEmail = body.email.trim().toLowerCase();
				if (await userQueries.getUser({ email: normalizedEmail })) {
					return;
				}

				const slackUser = await findSlackLinkedUserWithAliasedEmail(normalizedEmail);
				if (!slackUser) {
					return;
				}

				const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
				if (body.password.length < minPasswordLength) {
					throw new APIError('BAD_REQUEST', { message: 'Password is too short.' });
				}
				if (body.password.length > maxPasswordLength) {
					throw new APIError('BAD_REQUEST', { message: 'Password is too long.' });
				}

				const hashedPassword = await ctx.context.password.hash(body.password);
				const user = await accountQueries.claimSlackLinkedUser({
					userId: slackUser.id,
					email: normalizedEmail,
					name: body.name,
					hashedPassword,
				});
				const session = await ctx.context.internalAdapter.createSession(user.id, body.rememberMe === false);
				if (!session) {
					throw new APIError('INTERNAL_SERVER_ERROR', {
						message: 'Account setup could not be completed. Please try again.',
					});
				}

				const authUser = toAuthUser(user);
				await setSessionCookie(ctx, { session, user: authUser }, body.rememberMe === false);
				return ctx.json({ token: session.token, user: authUser });
			}),
			after: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== '/get-session' || !ctx.request) {
					return;
				}

				const result = ctx.context.returned as { session?: Session } | null;
				if (!result?.session || !(await shouldExpireSsoSession(result.session))) {
					return;
				}

				await ctx.context.internalAdapter.deleteSession(result.session.token);
				return new Response('null', {
					headers: { 'content-type': 'application/json' },
				});
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user, ctx) => {
						const providerId = resolveProviderId(ctx);

						if (
							!isCloud &&
							providerId === 'google' &&
							!isEmailDomainAllowed(user.email, googleConfig.authDomains)
						) {
							throw new APIError('FORBIDDEN', {
								message: 'This email domain is not authorized to access this application.',
							});
						}

						if (
							ssoEnabled &&
							providerId === getOidcProviderId() &&
							!isEmailDomainAllowed(user.email, env.OIDC_AUTH_DOMAINS ?? '')
						) {
							throw new APIError('FORBIDDEN', {
								message: 'This email domain is not authorized to access this application.',
							});
						}

						return true;
					},
					async after(user, ctx) {
						const providerId = resolveProviderId(ctx);
						const isSocial =
							providerId === 'google' ||
							providerId === 'github' ||
							providerId === 'gitlab' ||
							(ssoEnabled && (isSocialProviderMicrosoft(providerId) || isSocialProviderOidc(providerId)));

						try {
							if (isCloud) {
								const matchedOrg =
									providerId === 'google'
										? await orgQueries.findOrganizationByEmailDomain(user.email)
										: null;
								if (matchedOrg) {
									await orgQueries.addOrgMemberIfMissing({
										orgId: matchedOrg.id,
										userId: user.id,
										role: env.DEFAULT_USER_ROLE,
									});
								} else {
									await orgQueries.initializePersonalOrganization(user.id);
								}
							} else {
								await orgQueries.initializeDefaultOrganizationForFirstUser(user.id);
								if (isSocial) {
									await orgQueries.addUserToDefaultProjectIfExists(user.id);
								}
							}
							await refreshAuthAfterInitialSelfHostedSignup();
						} catch (err) {
							logger.error('Failed to initialize organization after user creation', {
								source: 'system',
								context: { userId: user.id, error: serializeError(err) },
							});
							throw new APIError('INTERNAL_SERVER_ERROR', {
								message: 'Account setup could not be completed. Please try again or contact support.',
							});
						}
					},
				},
				delete: {
					before: async (user) => {
						try {
							const { cleanupContextWorktree } = await import('./services/context-explorer-git.service');
							const projects = await projectQueries.listUserProjects(user.id);
							for (const project of projects) {
								if (project.path) {
									await cleanupContextWorktree(project.id, project.path, user.id);
								}
							}
						} catch (error) {
							logger.warn(`Failed to clean up context worktrees before deleting user ${user.id}`, {
								source: 'system',
								context: { error: serializeError(error) },
							});
						}
						return true;
					},
				},
			},
			session: {
				create: {
					async after(session, ctx) {
						if (!isSocialProviderOidc(resolveProviderId(ctx))) {
							return;
						}

						await syncRolesFromSsoGroups(session.userId);
					},
				},
			},
		},
		user: {
			additionalFields: {
				requiresPasswordReset: { type: 'boolean', default: false, input: false },
				messagingProviderCode: { type: 'string', default: '', input: false },
			},
		},
	});
}

async function findSlackLinkedUserWithAliasedEmail(email: string): Promise<DBUser | null> {
	const aliasConfigs = await slackConfigQueries.listSlackUserMatchingConfigs();
	const matchingUserIds = new Set<string>();

	for (const { projectId, domains } of aliasConfigs) {
		const aliasEmails = new Set(buildEmailDomainAliases(email, domains));
		if (aliasEmails.size === 0) {
			continue;
		}

		const users = await projectQueries.listUsersWithProjectAccess(projectId);
		const candidates = users.filter((user) => aliasEmails.has(user.email.toLowerCase()));
		for (const candidate of candidates) {
			if (await accountQueries.hasAccountForProvider(candidate.id, 'slack')) {
				matchingUserIds.add(candidate.id);
			}
		}
	}

	if (matchingUserIds.size > 1) {
		throw new APIError('CONFLICT', {
			message: 'Multiple Slack-linked accounts match this email. Contact an administrator.',
		});
	}

	const [userId] = matchingUserIds;
	return userId ? userQueries.getUser({ id: userId }) : null;
}

function toAuthUser(user: DBUser) {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: user.emailVerified,
		image: user.image,
		createdAt: user.createdAt,
		updatedAt: user.updatedAt,
		requiresPasswordReset: user.requiresPasswordReset,
		messagingProviderCode: user.messagingProviderCode ?? '',
	};
}

async function shouldDisableEmailSignUp(): Promise<boolean> {
	if (env.ENABLE_USER_SIGNUP) {
		return false;
	}

	const userCount = await userQueries.countUsers();
	return userCount > 0;
}

async function refreshAuthAfterInitialSelfHostedSignup(): Promise<void> {
	if (env.ENABLE_USER_SIGNUP) {
		return;
	}

	const userCount = await userQueries.countUsers();
	if (userCount === 1) {
		updateAuth();
	}
}

async function getAuthServerEndpoints(): Promise<{ issuer: string; jwksUrl: string }> {
	const auth = await getAuth();
	const context = await auth.$context;
	const issuer = context.baseURL;
	return { issuer, jwksUrl: `${issuer}/jwks` };
}
