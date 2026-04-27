import { getEeHooks } from '../ee';
import type { LicenseFeature, NaoLicense } from '../ee/types';
import { env } from '../env';
import { logger } from '../utils/logger';

export type { LicenseFeature, LicenseStatus, NaoLicense } from '../ee/types';
export { LICENSE_FEATURES, LICENSE_STATUSES } from '../ee/types';

export async function hasFeature(feature: LicenseFeature): Promise<boolean> {
	const hooks = await getEeHooks();
	return (await hooks?.hasFeature?.(feature)) ?? false;
}

export async function getLicense(): Promise<NaoLicense | null> {
	const hooks = await getEeHooks();
	return (await hooks?.getLicense?.()) ?? null;
}

export async function resetLicenseCache(): Promise<void> {
	const hooks = await getEeHooks();
	hooks?.resetLicenseCache?.();
}

/**
 * Verify the NAO_LICENSE (offline, against the bundled public key) and emit
 * a single status line so operators see at boot whether EE features are
 * active, expired, or not configured.
 */
export async function logLicenseStatus(): Promise<void> {
	const license = await getLicense();

	if (!license) {
		if (env.NAO_LICENSE) {
			logger.warn('NAO_LICENSE is set but could not be verified; enterprise features are disabled', {
				source: 'system',
			});
		} else {
			logger.info('No NAO_LICENSE configured; running in OSS mode', { source: 'system' });
		}
		return;
	}

	const expiry = license.expiresAt.toISOString().slice(0, 10);
	const companyName = license.companyName;
	const subscriptionId = license.subscriptionId;

	if (license.expiresAt.getTime() <= Date.now()) {
		logger.warn(
			`NAO_LICENSE for ${companyName} (${subscriptionId}) expired on ${expiry}; enterprise features are disabled`,
			{ source: 'system', context: { companyName, subscriptionId, expiresAt: license.expiresAt } },
		);
		return;
	}

	const features = license.features.length > 0 ? license.features.join(', ') : 'none';
	const trial = license.isTrial ? ' (trial)' : '';
	logger.info(`Licensed to ${companyName}${trial}; sub ${subscriptionId}; expires ${expiry}; features: ${features}`, {
		source: 'system',
		context: {
			companyName,
			subscriptionId,
			isTrial: license.isTrial,
			expiresAt: license.expiresAt,
			features: license.features,
		},
	});
}
