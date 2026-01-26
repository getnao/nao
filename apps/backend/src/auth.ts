import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import dbConfig, { Dialect } from './db/dbConfig';
import * as projectQueries from './queries/project.queries';

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
				async after(user) {
					// Handle first user signup: create default project and add user as admin
					await projectQueries.initializeDefaultProjectForFirstUser(user.id);
				},
			},
		},
	},
});
