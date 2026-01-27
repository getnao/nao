import { z } from 'zod/v4';

import { adminProtectedProcedure, publicProcedure } from './trpc';

export const googleRoutes = {
	isSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
	getSettings: adminProtectedProcedure.query(() => {
		return {
			clientId: process.env.GOOGLE_CLIENT_ID || '',
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
			authDomains: process.env.GOOGLE_AUTH_DOMAINS || '',
		};
	}),
	updateSettings: adminProtectedProcedure
		.input(
			z.object({
				clientId: z.string(),
				clientSecret: z.string(),
				authDomains: z.string(),
			}),
		)
		.mutation(({ input }) => {
			//TO DO : Save google settings in a secure store or database

			// process.env.GOOGLE_CLIENT_ID = input.clientId;
			// process.env.GOOGLE_CLIENT_SECRET = input.clientSecret;
			// process.env.GOOGLE_AUTH_DOMAINS = input.authDomains;

			return { success: true };
		}),
};
