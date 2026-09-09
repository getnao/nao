/* @license Enterprise */

import { isSocialProviderOidc } from './oidc-auth.service';

export async function syncSsoLoginGroups(userId: string, providerId: string | undefined): Promise<void> {
	if (providerId === 'microsoft') {
		await Promise.allSettled([
			import('./microsoft-user-group-membership.service').then(({ syncUserGroupsFromMicrosoft }) =>
				syncUserGroupsFromMicrosoft(userId),
			),
		]);
		return;
	}

	if (!isSocialProviderOidc(providerId)) {
		return;
	}
	await Promise.allSettled([
		import('./sso-group-mapping.service').then(({ syncRolesFromSsoGroups }) => syncRolesFromSsoGroups(userId)),
		import('./sso-user-group-membership.service').then(({ syncUserGroupsFromOidc }) =>
			syncUserGroupsFromOidc(userId),
		),
	]);
}
