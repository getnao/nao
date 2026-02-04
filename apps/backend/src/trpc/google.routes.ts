import { z } from 'zod/v4';

import { env } from '../env';
import { adminProtectedProcedure, publicProcedure } from './trpc';

export const googleRoutes = {
	isSetup: publicProcedure.query(() => {
		return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
	}),
	getSettings: adminProtectedProcedure.query(() => {
		return {
			clientId: env.GOOGLE_CLIENT_ID || '',
			clientSecret: env.GOOGLE_CLIENT_SECRET || '',
			authDomains: env.GOOGLE_AUTH_DOMAINS || '',
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
