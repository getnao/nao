import type { LicenseStatus } from '../ee/types';
import { env } from '../env';
import { getLicense, hasFeature, LICENSE_FEATURES, type LicenseFeature } from '../services/license.service';
import { publicProcedure } from './trpc';

export const licenseRoutes = {
	getStatus: publicProcedure.query(async () => {
		const tokenProvided = Boolean(env.NAO_LICENSE);
		const license = await getLicense();

		if (!license) {
			const status: LicenseStatus = tokenProvided ? 'invalid' : 'unlicensed';
			return { status, tokenProvided };
		}

		const status: LicenseStatus = license.expiresAt.getTime() <= Date.now() ? 'expired' : 'active';
		return {
			status,
			tokenProvided,
			companyName: license.companyName,
			subscriptionId: license.subscriptionId,
			isTrial: license.isTrial,
			expiresAt: license.expiresAt,
			features: license.features,
		};
	}),

	getFeatures: publicProcedure.query(async () => {
		const features = Object.values(LICENSE_FEATURES);
		const entries = await Promise.all(features.map(async (f) => [f, await hasFeature(f)] as const));
		return Object.fromEntries(entries) as Record<LicenseFeature, boolean>;
	}),
};
