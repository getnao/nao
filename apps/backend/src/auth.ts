import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import { env } from './env';
import * as orgQueries from './queries/organization.queries';
import { isEmailDomainAllowed } from './utils/utils';

type GoogleConfig = Awaited<ReturnType<typeof orgQueries.getGoogleConfig>>;

function createAuthInstance(googleConfig: GoogleConfig) {
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
		socialProviders: {
			google: {
				prompt: 'select_account',
				clientId: googleConfig.clientId,
				clientSecret: googleConfig.clientSecret,
			},
		},
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
						const isGoogle = ctx?.params?.id === 'google';
						await orgQueries.initializeDefaultOrganizationForFirstUser(user.id);
						if (isGoogle) {
							await orgQueries.addUserToDefaultProjectIfExists(user.id);
						}
					},
				},
			},
		},
		user: {
			additionalFields: {
				requiresPasswordReset: { type: 'boolean', default: false, input: false },
			},
		},
	});
}

let authPromise = orgQueries.getGoogleConfig().then(createAuthInstance);

export const getAuth = () => authPromise;

export function updateAuth() {
	authPromise = orgQueries.getGoogleConfig().then(createAuthInstance);
}
