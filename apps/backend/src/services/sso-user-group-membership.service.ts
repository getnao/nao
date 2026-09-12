/* @license Enterprise */

import { env } from '../env';
import {
	hasSsoUserGroupSyncState,
	reconcileSsoUserGroupMemberships,
} from '../queries/sso-user-group-membership.queries';
import { logger, serializeError } from '../utils/logger';
import { readGroupsClaim } from '../utils/sso-group-mapping';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { getOidcProviderId, isOidcConfigured } from './oidc-auth.service';
import { DEFAULT_GROUPS_CLAIM } from './sso-group-mapping.service';
import { readClaimsFromIdToken } from './sso-token.service';

export async function syncUserGroupsFromOidc(userId: string): Promise<void> {
	try {
		if (!(await canSyncOidcUserGroups(userId))) {
			return;
		}

		const token = await readClaimsFromIdToken(userId, getOidcProviderId());
		if (token.status !== 'decoded') {
			logger.warn('Could not read the OIDC groups claim, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, problem: token.status },
			});
			return;
		}

		const claimName = env.OIDC_GROUPS_CLAIM ?? DEFAULT_GROUPS_CLAIM;
		const claim = readGroupsClaim(token.claims, claimName);
		if (claim.status !== 'valid') {
			logger.warn('The OIDC groups claim is unavailable, leaving User Group memberships untouched', {
				source: 'system',
				context: { userId, claimName, problem: claim.status },
			});
			return;
		}

		await reconcileSsoUserGroupMemberships(userId, 'oidc', claim.groups);
	} catch (error) {
		logger.error('Failed to sync User Group memberships from OIDC', {
			source: 'system',
			context: { userId, error: serializeError(error) },
		});
	}
}

async function canSyncOidcUserGroups(userId: string): Promise<boolean> {
	if (!isOidcConfigured()) {
		return false;
	}
	if (!(await hasFeature(LICENSE_FEATURES.sso))) {
		return false;
	}
	return hasSsoUserGroupSyncState(userId, 'oidc');
}
