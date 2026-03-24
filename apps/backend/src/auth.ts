import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import { env } from './env';
import * as orgQueries from './queries/organization.queries';
import { buildGithubAllowlist, isEmailDomainAllowed } from './utils/utils';

type GoogleConfig = Awaited<ReturnType<typeof orgQueries.getGoogleConfig>>;

function createAuthInstance(googleConfig: GoogleConfig) {
	const githubAllowlist = buildGithubAllowlist(env.GITHUB_ALLOWED_USERS);

	const socialProviders: Parameters<typeof betterAuth>[0]['socialProviders'] = {
		google: {
			prompt: 'select_account',
			clientId: googleConfig.clientId,
			clientSecret: googleConfig.clientSecret,
		},
	};

	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		socialProviders.github = {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
			getUserInfo: async (token) => {
				const res = await fetch('https://api.github.com/user', {
					headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
				});
				const profile = await res.json();

				if (githubAllowlist.size > 0 && !githubAllowlist.has(profile.login)) {
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

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, {
			provider: dbConfig.dialect === Dialect.Postgres ? 'pg' : 'sqlite',
			schema: dbConfig.schema,
		}),
		trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : undefined,
		emailAndPassword: {
			enabled: true,
		},
		socialProviders,
		databaseHooks: {
			user: {
				create: {
					before: async (user, ctx) => {
						const isGoogle = ctx?.params?.id === 'google';
						if (isGoogle && !isEmailDomainAllowed(user.email, googleConfig.authDomains)) {
							throw new APIError('FORBIDDEN', {
								message: 'This email domain is not authorized to access this application.',
							});
						}
						return true;
					},
					async after(user, ctx) {
						const isSocial = ctx?.params?.id === 'google' || ctx?.params?.id === 'github';
						await orgQueries.initializeDefaultOrganizationForFirstUser(user.id);
						if (isSocial) {
							await orgQueries.addUserToDefaultProjectIfExists(user.id);
						}
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

let authPromise: Promise<ReturnType<typeof createAuthInstance>> | null = null;

export const getAuth = () => {
	if (!authPromise) {
		authPromise = orgQueries.getGoogleConfig().then(createAuthInstance);
	}
	return authPromise;
};

export function updateAuth() {
	authPromise = orgQueries.getGoogleConfig().then(createAuthInstance);
}
