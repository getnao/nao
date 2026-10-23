/* @license Enterprise */

import { TRPCError } from '@trpc/server';

import { env } from '../env';
import { getFeatureAvailability, getLicense, isLicenseExpired, type LicenseScope } from '../services/license.service';
import type { LicenseStatus } from '../types/license';
import { advancedSettingsProtectedProcedure, protectedProcedure, resolveOrganizationMembership } from './trpc';

export const licenseRoutes = {
	getStatus: protectedProcedure.query(async () => {
		const tokenProvided = Boolean(env.NAO_LICENSE);
		const license = await getLicense();

		if (!license) {
			const status: LicenseStatus = tokenProvided ? 'invalid' : 'unlicensed';
			return { status, tokenProvided };
		}

		const status: LicenseStatus = isLicenseExpired(license) ? 'expired' : 'active';
		return { status, tokenProvided };
	}),

	getDetails: advancedSettingsProtectedProcedure.query(async () => {
		const license = await getLicense();
		if (!license) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'No license configured.' });
		}
		return {
			companyName: license.companyName,
			subscriptionId: license.subscriptionId,
			isOffline: license.isOffline,
			expiresAt: license.expiresAt,
			features: license.features,
		};
	}),

	getFeatures: protectedProcedure.query(async ({ ctx }) => {
		const scope = await resolveSelectedOrganizationScope(
			ctx.user.id,
			ctx.selectedProjectId,
			ctx.selectedOrganizationId,
		);
		return getFeatureAvailability(scope);
	}),
};

async function resolveSelectedOrganizationScope(
	userId: string,
	selectedProjectId: string | null,
	selectedOrganizationId: string | null,
): Promise<LicenseScope | undefined> {
	try {
		const membership = await resolveOrganizationMembership(userId, selectedProjectId, selectedOrganizationId);
		return { orgId: membership.organization.id };
	} catch (error) {
		if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
			return undefined;
		}
		throw error;
	}
}
