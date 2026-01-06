import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from './db/db';
import { provider, schema } from './utils';

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: provider,
		schema,
	}),
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
});
