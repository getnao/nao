import * as orgQueries from '../queries/organization.queries';
import { isSocialProviderMicrosoft } from './microsoft-auth.service';
import { isSocialProviderOidc } from './oidc-auth.service';

export async function initializeSelfHostedUserAfterCreation(
	userId: string,
	providerId: string | undefined,
	ssoEnabled: boolean,
): Promise<void> {
	await orgQueries.initializeDefaultOrganizationForFirstUser(userId);

	const isSsoProvider = ssoEnabled && (isSocialProviderMicrosoft(providerId) || isSocialProviderOidc(providerId));
	if (isSsoProvider) {
		await orgQueries.addUserToDefaultOrganizationIfExists(userId);
		return;
	}

	if (providerId === 'google' || providerId === 'github' || providerId === 'gitlab') {
		await orgQueries.addUserToDefaultProjectIfExists(userId);
	}
}
