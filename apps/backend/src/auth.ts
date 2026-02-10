import { APIError, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import { env } from './env';
import * as orgQueries from './queries/organization.queries';
import { isEmailDomainAllowed } from './utils/utils';

export const auth = betterAuth({
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
			clientId: env.GOOGLE_CLIENT_ID as string,
			clientSecret: env.GOOGLE_CLIENT_SECRET as string,
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user, ctx) => {
					const provider = ctx?.params?.id;
					if (provider && provider == 'google' && !isEmailDomainAllowed(user.email)) {
						throw new APIError('FORBIDDEN', {
							message: 'This email domain is not authorized to access this application.',
						});
					}
					return true;
				},
				async after(user) {
					// Handle first user signup: create default org and project in a single transaction
					await orgQueries.initializeDefaultOrganizationForFirstUser(user.id);
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
