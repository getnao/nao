/* @license Enterprise */

import { isCloud } from '../env';
import { addUserToDefaultOrganizationIfExists } from '../queries/organization.queries';
import { isSocialProviderOidc } from './oidc-auth.service';

export async function syncSsoLoginGroups(userId: string, providerId: string | undefined): Promise<void> {
	const isMicrosoft = providerId === 'microsoft';
	const isOidc = isSocialProviderOidc(providerId);
	if (!isMicrosoft && !isOidc) {
		return;
	}

	if (!isCloud) {
		await Promise.allSettled([addUserToDefaultOrganizationIfExists(userId)]);
	}

	if (isMicrosoft) {
		await Promise.allSettled([
			import('./microsoft-user-group-membership.service').then(({ syncUserGroupsFromMicrosoft }) =>
				syncUserGroupsFromMicrosoft(userId),
			),
		]);
		return;
	}

	await Promise.allSettled([
		import('./sso-user-group-membership.service').then(({ syncUserGroupsFromOidc }) =>
			syncUserGroupsFromOidc(userId),
		),
	]);
	await Promise.allSettled([
		import('./sso-group-mapping.service').then(({ syncOrganizationRoleFromSsoGroups }) =>
			syncOrganizationRoleFromSsoGroups(userId),
		),
	]);
}
