/* @license Enterprise */

import { env } from '../env';
import { logger } from '../utils/logger';
import { getLicense } from './license.service';

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
