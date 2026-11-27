import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import { registerEnvLlmConfigs } from './env-llm-config.service';
import { applyProjectGroupsFile } from './groups-config-apply.service';
import { isSocialProviderMicrosoft } from './microsoft-auth.service';
import { isSocialProviderOidc } from './oidc-auth.service';

export async function initializeSelfHostedUserAfterCreation(
	userId: string,
	providerId: string | undefined,
	ssoEnabled: boolean,
): Promise<void> {
	await orgQueries.initializeDefaultOrganizationForFirstUser(userId);
	const project = await projectQueries.getDefaultProject();
	if (project) {
		await registerEnvLlmConfigs(project.id);
		if (project.path) {
			await applyProjectGroupsFile(project.id, project.path, userId);
		}
	}

	const isSsoProvider = ssoEnabled && (isSocialProviderMicrosoft(providerId) || isSocialProviderOidc(providerId));
	if (isSsoProvider) {
		await orgQueries.addUserToDefaultOrganizationIfExists(userId);
		return;
	}

	if (providerId === 'google' || providerId === 'github' || providerId === 'gitlab') {
		await orgQueries.addUserToDefaultProjectIfExists(userId);
	}
}
