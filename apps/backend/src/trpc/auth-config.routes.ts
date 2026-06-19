import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { updateAuth } from '../auth';
import { env, isCloud } from '../env';
import * as orgQueries from '../queries/organization.queries';
import { emailService } from '../services/email';
import { isGithubSsoEnabled } from '../services/github';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { isMicrosoftConfigured } from '../services/microsoft-auth.service';
import { getOidcProviderId, isOidcConfigured } from '../services/oidc-auth.service';
import { adminProtectedProcedure, publicProcedure } from './trpc';

export const authConfigRoutes = {
	google: {
		isSetup: publicProcedure.query(async () => {
			// Cloud uses a single deployment-level credential; org membership is then
			// resolved from the user's email domain after sign-in.
			if (isCloud) {
				return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
			}
			const config = await orgQueries.getGoogleConfig();
			return !!(config.clientId && config.clientSecret);
		}),
		getSettings: adminProtectedProcedure.query(async ({ ctx }) => {
			if (!ctx.project.orgId) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found for project' });
			}
			const config = await orgQueries.getGoogleConfigForOrganization(ctx.project.orgId, !isCloud);
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
			.mutation(async ({ input, ctx }) => {
				if (isCloud) {
					throw new TRPCError({
						code: 'FORBIDDEN',
						message: 'Google SSO settings are managed at the deployment level in cloud mode.',
					});
				}
				if (!ctx.project.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found for project' });
				}
				const org = await orgQueries.getOrganizationById(ctx.project.orgId);
				if (!org) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'No organization found' });
				}
				await orgQueries.updateGoogleSettings(org.id, {
					googleClientId: input.clientId || org.googleClientId,
					googleClientSecret: input.clientSecret || org.googleClientSecret,
					googleAuthDomains: input.authDomains || null,
				});
				updateAuth();
				return { success: true };
			}),
	},
	github: {
		isSetup: publicProcedure.query(() => isGithubSsoEnabled()),
	},
	microsoft: {
		isSetup: publicProcedure.query(async () => {
			if (!(await hasFeature(LICENSE_FEATURES.sso))) {
				return false;
			}
			return isMicrosoftConfigured();
		}),
	},
	oidc: {
		getConfig: publicProcedure.query(async () => {
			if (!(await hasFeature(LICENSE_FEATURES.sso))) {
				return null;
			}
			if (!isOidcConfigured()) {
				return null;
			}
			return {
				providerId: getOidcProviderId(),
				providerName: env.OIDC_PROVIDER_NAME ?? 'SSO',
			};
		}),
	},
	smtp: {
		isSetup: publicProcedure.query(() => emailService.isEnabled()),
	},
};
