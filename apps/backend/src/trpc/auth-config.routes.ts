import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { updateAuth } from '../auth';
import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import { emailService } from '../services/email';
import { adminProtectedProcedure, publicProcedure } from './trpc';

export const authConfigRoutes = {
	google: {
		isSetup: publicProcedure.query(async () => {
			if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
				return true;
			}
			const org = await orgQueries.getFirstOrganization();
			return !!(org?.googleClientId && org?.googleClientSecret);
		}),
		getSettings: adminProtectedProcedure.query(async () => {
			const config = await orgQueries.getGoogleConfig();
			return { ...config };
		}),
		updateSettings: adminProtectedProcedure
			.input(
				z.object({
					clientId: z.string(),
					clientSecret: z.string(),
					authDomains: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const org = await orgQueries.getFirstOrganization();
				if (!org) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found' });
				}
				await orgQueries.updateGoogleSettings(org.id, {
					googleClientId: input.clientId || null,
					googleClientSecret: input.clientSecret || null,
					googleAuthDomains: input.authDomains || null,
				});
				updateAuth();
				return { success: true };
			}),
	},
	github: {
		isSetup: publicProcedure.query(() => {
			return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
		}),
	},
	smtp: {
		isSetup: publicProcedure.query(() => emailService.isEnabled()),
		getSettings: adminProtectedProcedure.query(async () => {
			const config = await orgQueries.getSmtpConfig();
			return { ...config, hasPassword: !!config.password, password: undefined };
		}),
		updateSettings: adminProtectedProcedure
			.input(
				z.object({
					host: z.string(),
					port: z.string().regex(/^\d*$/, 'Port must be a number').optional().default('587'),
					ssl: z.enum(['true', 'false']).optional().default('false'),
					mailFrom: z.string(),
					password: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const org = await orgQueries.getFirstOrganization();
				if (!org) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found' });
				}
				const password = input.password ? input.password : org.smtpPassword || null;
				await orgQueries.updateSmtpSettings(org.id, {
					smtpHost: input.host || null,
					smtpPort: input.port || null,
					smtpSsl: input.ssl || null,
					smtpMailFrom: input.mailFrom || null,
					smtpPassword: password,
				});
				const updatedConfig = await orgQueries.getSmtpConfig();
				emailService.reload(updatedConfig);
				return { success: true };
			}),
	},
};
