import type { ResourceServerMetadata } from '@better-auth/oauth-provider';
import {
	oauthProvider,
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import type { BetterAuthPlugin, Session } from 'better-auth';
import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { jwt, signJWT } from 'better-auth/plugins';
import { bearer } from 'better-auth/plugins/bearer';
import type { JWTPayload } from 'jose';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import {
	env,
	isCloud,
	isCloudWelcomeEmailEnabled,
	isMcpPublicHost,
	MCP_PUBLIC_ORIGIN,
	MCP_PUBLIC_SERVER_URL,
	MCP_VALID_AUDIENCES,
} from './env';
import { rebaseOrigin } from './mcp/public-auth-metadata';
import {
	isAuthorizationResponse,
	isPublicResourceFlow,
	publicFlowMarkerId,
	reissueTokenResponse,
	rewriteLocationIssuer,
	rewriteRedirectIssuer,
	sameOriginRedirectPath,
} from './mcp/public-issuer';
import { verifyJwtWithLocalJwks } from './mcp/verify-jwt';
import * as orgQueries from './queries/organization.queries';
import * as projectQueries from './queries/project.queries';
import * as userQueries from './queries/user.queries';
import { DEACTIVATED_ACCOUNT_MESSAGE } from './services/account-status.service';
import { initializeSelfHostedUserAfterCreation } from './services/auth-user-onboarding.service';
import { activateUserJoinCandidates } from './services/credit-grant.service';
import { emailService } from './services/email';
import { githubOAuthConfig } from './services/github';
import * as gitlabService from './services/gitlab';
import { hasFeature, LICENSE_FEATURES } from './services/license.service';
import { addOrganizationMemberIfMissing } from './services/membership.service';
import {
	augmentSocialProvidersWithMicrosoft,
	getTrustedProvidersForMicrosoft,
} from './services/microsoft-auth.service';
import { augmentPluginsWithOidc, getOidcProviderId, getTrustedProvidersForOidc } from './services/oidc-auth.service';
import { enqueueOnce } from './services/scheduler.service';
import { syncSsoLoginGroups } from './services/sso-login-sync.service';
import { shouldExpireSsoSession } from './services/sso-session.service';
import { CLOUD_WELCOME_EMAIL_JOB_NAME } from './types/email';
import { buildAccountExistsEmail, buildForgotPasswordEmail, buildVerifyEmail } from './utils/email-builders';
import { logger, serializeError } from './utils/logger';
import { memoizeUntilRejected } from './utils/memoize-until-rejected';
import { buildUsernameAllowlist, isEmailDomainAllowed, resolveProviderId } from './utils/utils';

type MetadataHandler = (request: Request) => Promise<Response>;

const OAUTH_LOGIN_PAGE = '/login';
const OAUTH_CONSENT_PAGE = '/consent';
/** How long a public-MCP flow may take from authorize to consent. */
const PUBLIC_FLOW_MARKER_TTL_MS = 10 * 60 * 1000;

const defaultAuth = memoizeUntilRejected<Awaited<ReturnType<typeof createAuthInstance>>>(() =>
	createAuthInstance(env.BETTER_AUTH_URL),
);
const authServerMetadata = memoizeUntilRejected<MetadataHandler>(async () =>
	oauthProviderAuthServerMetadata(await getAuth()),
);
const openIdConfigMetadata = memoizeUntilRejected<MetadataHandler>(async () =>
	oauthProviderOpenIdConfigMetadata(await getAuth()),
);

export const getAuth = () => defaultAuth.get();

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
	defaultAuth.reset();
	authServerMetadata.reset();
	openIdConfigMetadata.reset();
}

export async function verifyOAuthAccessToken(token: string, audience: string[]): Promise<JWTPayload> {
	const auth = await getAuth();
	const { issuer } = await getAuthServerEndpoints();
	// Verify against the LOCAL JWKS. nao is the token issuer, so it already holds
	// its own signing keys. better-auth's verifyAccessToken instead fetches them
	// over the external issuer URL (BETTER_AUTH_URL/jwks); in self-hosted
	// split-horizon deployments that host is not resolvable from the server's own
	// network, so the fetch throws, better-auth swallows it, and every MCP token
	// is rejected with "no token payload". Using the in-process key set avoids the
	// self-referential round-trip entirely.
	const { keys } = await auth.api.getJwks();
	// Tokens minted for the public MCP host carry the public issuer (see applyPublicIssuer).
	const issuers = MCP_PUBLIC_ORIGIN ? [issuer, rebaseOrigin(issuer, MCP_PUBLIC_ORIGIN)] : issuer;
	return verifyJwtWithLocalJwks(token, { audience, issuer: issuers, keys });
}

/**
 * RFC 9728 protected-resource metadata. `facingOrigin` is the origin the client is
 * talking to: on the public MCP host the authorization server is advertised there too,
 * so a client that follows discovery never needs to reach the private UI host.
 */
export async function buildProtectedResourceMetadata(
	overrides: ResourceServerMetadata,
	facingOrigin?: string,
): Promise<ResourceServerMetadata> {
	const { issuer } = await getAuthServerEndpoints();
	return {
		authorization_servers: [facingOrigin ? rebaseOrigin(issuer, facingOrigin) : issuer],
		...overrides,
	};
}

export function getAuthServerMetadataHandler(): Promise<MetadataHandler> {
	return authServerMetadata.get();
}

export function getOpenIdConfigMetadataHandler(): Promise<MetadataHandler> {
	return openIdConfigMetadata.get();
}

async function createAuthInstance(baseURL: string) {
	const githubAllowlist = buildUsernameAllowlist(env.GITHUB_ALLOWED_USERS);
	const gitlabAllowlist = buildUsernameAllowlist(env.GITLAB_ALLOWED_USERS);
	const disableEmailSignUp = await shouldDisableEmailSignUp();
	const emailVerificationEnabled = isCloud && emailService.isEnabled();

	const ssoPlugins: BetterAuthPlugin[] = [];

	// Cloud uses a single deployment-level Google credential; self-hosted reads the
	// org-level credential (with env fallback) so existing instances keep working.
	const googleConfig = await orgQueries.getGoogleConfig();
	const googleClientId = isCloud ? env.GOOGLE_CLIENT_ID : googleConfig.clientId;
	const googleClientSecret = isCloud ? env.GOOGLE_CLIENT_SECRET : googleConfig.clientSecret;
	const googleAuthDomains = isCloud ? env.GOOGLE_AUTH_DOMAINS : googleConfig.authDomains;

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
				loginPage: OAUTH_LOGIN_PAGE,
				consentPage: OAUTH_CONSENT_PAGE,
				accessTokenExpiresIn: env.MCP_ACCESS_TOKEN_TTL,
				refreshTokenExpiresIn: env.MCP_REFRESH_TOKEN_TTL,
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: env.ALLOW_UNAUTHENTICATED_DCR,
				validAudiences: MCP_VALID_AUDIENCES,
			}),
			...ssoPlugins,
		],
		trustedOrigins: baseURL ? [baseURL, ...(env.MODE === 'dev' ? ['http://localhost:3000'] : [])] : undefined,
		emailVerification: emailVerificationEnabled
			? {
					sendVerificationEmail: async ({ user, url }) => {
						await emailService.sendEmail(user.email, await buildVerifyEmail(user, url), {
							throwOnError: true,
						});
					},
					sendOnSignUp: true,
					autoSignInAfterVerification: true,
					expiresIn: 60 * 60,
					afterEmailVerification: async (user) => {
						await enqueueVerifiedUserWelcomeEmail(user.id);
					},
				}
			: undefined,
		emailAndPassword: {
			enabled: env.ENABLE_USER_LOGIN === true,
			disableSignUp: disableEmailSignUp,
			requireEmailVerification: emailVerificationEnabled,
			sendResetPassword: async ({ user, url }) => {
				await emailService.sendEmail(user.email, await buildForgotPasswordEmail(user, url));
			},
			onPasswordReset: async ({ user }) => {
				if (!user.emailVerified && (await userQueries.markEmailVerified(user.id))) {
					await enqueueVerifiedUserWelcomeEmail(user.id);
				}
			},
			onExistingUserSignUp: async ({ user }, request) => {
				await emailExistingAccountOwner(user, await readSignUpCallbackURL(request));
			},
		},
		rateLimit: isCloud
			? {
					enabled: true,
					customRules: {
						'/send-verification-email': {
							window: 60,
							max: 3,
						},
					},
				}
			: undefined,
		socialProviders,
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders,
			},
		},
		hooks: {
			after: createAuthMiddleware(async (ctx) => {
				const publicIssuerResponse = await applyPublicIssuer(ctx);
				if (publicIssuerResponse !== undefined) {
					return publicIssuerResponse;
				}

				if (ctx.path === '/send-verification-email') {
					const returned = ctx.context.returned as { status?: unknown } | undefined;
					const existing =
						returned?.status === true
							? await ctx.context.internalAdapter.findUserByEmail(ctx.body.email)
							: null;
					if (existing?.user.emailVerified) {
						await sendAccountExistsEmail(existing.user);
					}
					return;
				}

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

						if (providerId === 'google' && !isEmailDomainAllowed(user.email, googleAuthDomains)) {
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

						try {
							if (isCloud) {
								const matchedOrg =
									providerId === 'google'
										? await orgQueries.findOrganizationByEmailDomain(user.email)
										: null;
								if (matchedOrg) {
									await addOrganizationMemberIfMissing({
										orgId: matchedOrg.id,
										userId: user.id,
										role: env.DEFAULT_USER_ROLE,
									});
								} else {
									await orgQueries.initializePersonalOrganization(user.id);
								}
							} else {
								await initializeSelfHostedUserAfterCreation(user.id, providerId, ssoEnabled);
							}
							await enqueueVerifiedUserWelcomeEmail(user.id);
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
					before: async (session) => {
						if (await userQueries.isUserDeactivated(session.userId)) {
							throw new APIError('FORBIDDEN', { message: DEACTIVATED_ACCOUNT_MESSAGE });
						}
						return true;
					},
					async after(session, ctx) {
						await syncSsoLoginGroups(session.userId, resolveProviderId(ctx));
						await activateUserJoinCandidates(session.userId);
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

async function emailExistingAccountOwner(
	user: { email: string; name: string; emailVerified: boolean },
	callbackURL: string,
) {
	if (user.emailVerified) {
		await sendAccountExistsEmail(user);
		return;
	}
	const auth = await getAuth();
	await auth.api.sendVerificationEmail({ body: { email: user.email, callbackURL } });
}

async function readSignUpCallbackURL(request: Request | undefined): Promise<string> {
	const body: unknown = await request?.json().catch(() => undefined);
	const callbackURL = (body as { callbackURL?: unknown } | undefined)?.callbackURL;
	return typeof callbackURL === 'string' ? callbackURL : '/email-verified';
}

async function sendAccountExistsEmail(user: { email: string; name: string }) {
	await emailService.sendEmail(user.email, await buildAccountExistsEmail(user, env.BETTER_AUTH_URL));
}

async function enqueueVerifiedUserWelcomeEmail(userId: string): Promise<void> {
	if (!isCloudWelcomeEmailEnabled()) {
		return;
	}
	try {
		const user = await userQueries.getUser({ id: userId });
		if (!user?.emailVerified || user.requiresPasswordReset) {
			return;
		}
		await enqueueOnce({
			name: CLOUD_WELCOME_EMAIL_JOB_NAME,
			payload: { kind: 'user', userId },
			uniqueKey: `email-cloud-welcome-user:${userId}`,
		});
	} catch (error) {
		logger.error('Failed to enqueue cloud user welcome email', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
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

async function getAuthServerEndpoints(): Promise<{ issuer: string }> {
	const auth = await getAuth();
	const context = await auth.$context;
	return { issuer: context.baseURL };
}

/** Endpoint context as seen by an after-hook: the endpoint's result and response headers. */
type AuthEndpointContext = Parameters<typeof signJWT>[0] & {
	context: { returned?: unknown; responseHeaders?: Headers };
};

/**
 * Per-flow issuer for the public MCP host. Discovery there advertises the public issuer,
 * so a flow for the public MCP resource must see that issuer everywhere: in the
 * authorization response `iss` (RFC 9207, set on the UI host after consent) and in the
 * tokens issued on the public host. Returns a replacement response, or undefined to keep
 * better-auth's.
 */
async function applyPublicIssuer(ctx: AuthEndpointContext): Promise<unknown> {
	if (!MCP_PUBLIC_ORIGIN || !MCP_PUBLIC_SERVER_URL || !ctx.path.startsWith('/oauth2/')) {
		return undefined;
	}
	const uiIssuer = ctx.context.baseURL;
	const publicIssuer = rebaseOrigin(uiIssuer, MCP_PUBLIC_ORIGIN);
	const returned = ctx.context.returned as unknown;

	if (ctx.path === '/oauth2/authorize' || ctx.path === '/oauth2/consent') {
		const body = ctx.body as { oauth_query?: unknown } | undefined;
		const query = (ctx.query ?? {}) as Record<string, unknown>;
		const oauthQuery = typeof body?.oauth_query === 'string' ? body.oauth_query : undefined;
		const flowParams = oauthQuery
			? new URLSearchParams(oauthQuery)
			: new URLSearchParams(
					Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
				);
		const markerId = publicFlowMarkerId(flowParams);
		let isPublic = isPublicResourceFlow({ resource: query.resource, oauthQuery }, MCP_PUBLIC_SERVER_URL);
		const jsonRedirect =
			returned && typeof returned === 'object' && 'url' in returned && typeof returned.url === 'string'
				? returned.url
				: undefined;
		const redirectUrl = ctx.context.responseHeaders?.get('location') ?? jsonRedirect;

		if (ctx.path === '/oauth2/authorize' && isPublic && markerId && redirectUrl) {
			// better-auth drops `resource` from the query it signs for the login/consent pages;
			// remember the flow so those steps can still tell it targets the public host. Only
			// once better-auth accepted the client and redirect_uri, i.e. it is sending the user
			// on to sign in or consent (not for error redirects or unknown clients).
			const next = sameOriginRedirectPath(redirectUrl, uiIssuer);
			if (next === OAUTH_LOGIN_PAGE || next === OAUTH_CONSENT_PAGE) {
				// A retried authorize request reuses the key: keep a single, fresh marker.
				await ctx.context.internalAdapter.deleteVerificationByIdentifier(markerId);
				await ctx.context.internalAdapter.createVerificationValue({
					identifier: markerId,
					value: MCP_PUBLIC_SERVER_URL,
					expiresAt: new Date(Date.now() + PUBLIC_FLOW_MARKER_TTL_MS),
				});
			}
		}
		// Every later step arrives without `resource`: consent, and authorize resumed after a
		// password sign-in (with `oauth_query`) or a social sign-in callback (with neither).
		if (!isPublic && markerId) {
			const marker = await ctx.context.internalAdapter.findVerificationValue(markerId);
			isPublic = Boolean(marker && new Date(marker.expiresAt) > new Date());
		}
		if (!isPublic) {
			return undefined;
		}
		// The flow ends with this authorization response: the marker is single-use.
		if (markerId && redirectUrl && isAuthorizationResponse(redirectUrl)) {
			await ctx.context.internalAdapter.deleteVerificationByIdentifier(markerId);
		}
		// Redirect thrown as a 302: rewrite its Location. When authorize runs nested in a social
		// sign-in callback, the thrown error's own headers win over responseHeaders: rewrite both.
		rewriteLocationIssuer(ctx.context.responseHeaders, uiIssuer, publicIssuer);
		if (isAPIError(returned) && returned.headers instanceof Headers) {
			rewriteLocationIssuer(returned.headers, uiIssuer, publicIssuer);
		}
		// Redirect returned as JSON to a fetch() caller (the consent page).
		if (returned && typeof returned === 'object' && 'url' in returned && typeof returned.url === 'string') {
			return { ...returned, url: rewriteRedirectIssuer(returned.url, uiIssuer, publicIssuer) };
		}
		return undefined;
	}

	if (ctx.path === '/oauth2/token') {
		const host = ctx.headers?.get('x-forwarded-host') ?? ctx.headers?.get('host') ?? undefined;
		if (!isMcpPublicHost(host) || !returned || typeof returned !== 'object' || !('access_token' in returned)) {
			return undefined;
		}
		const options = ctx.context.options.plugins?.find((plugin) => plugin.id === 'jwt')?.options;
		return reissueTokenResponse(returned as Record<string, unknown>, uiIssuer, publicIssuer, (payload) =>
			signJWT(ctx, { options, payload }),
		);
	}

	return undefined;
}
