import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import * as projectQueries from './queries/project.queries';
import { isEmailDomainAllowed } from './utils/utils';

// Validate BETTER_AUTH_URL if provided to throw error when starting nao chat
const betterAuthUrl = process.env.BETTER_AUTH_URL;
if (betterAuthUrl) {
	try {
		new URL(betterAuthUrl);
	} catch {
		throw new Error(
			`Invalid BETTER_AUTH_URL environment variable: "${betterAuthUrl}"\n` +
				`BETTER_AUTH_URL must be a valid URL (e.g., http://localhost:5005).\n`,
		);
	}
}

export const auth = betterAuth({
	secret: process.env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: dbConfig.dialect === Dialect.Postgres ? 'pg' : 'sqlite',
		schema: dbConfig.schema,
	}),
	trustedOrigins: process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(',') : undefined,
	emailAndPassword: {
		enabled: true,
	},
	socialProviders: {
		google: {
			prompt: 'select_account',
			clientId: process.env.GOOGLE_CLIENT_ID as string,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user, ctx) => {
					const provider = ctx?.params?.id;
					if (provider && provider == 'google' && !isEmailDomainAllowed(user.email)) {
						return false;
					}
					return true;
				},
				async after(user) {
					// Handle first user signup: create default project and add user as admin
					await projectQueries.initializeDefaultProjectForFirstUser(user.id);
				},
			},
		},
	},
});
