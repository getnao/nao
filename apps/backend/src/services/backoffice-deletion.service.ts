/* @license Enterprise */

import fs from 'node:fs/promises';
import path from 'node:path';

import { env, isCloudBillingEnabled } from '../env';
import * as backofficeQueries from '../queries/backoffice.queries';
import { getOrganizationBilling } from '../queries/billing.queries';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { HandlerError } from '../utils/error';
import { logger } from '../utils/logger';
import { getStorage, isStorageEnabled } from './storage';
import { projectRoot } from './storage/keys';
import { cancelCloudSubscription } from './stripe.service';

/** Removes a project with its database rows, scheduled jobs, stored files and context folder. */
export async function deleteProjectPermanently(projectId: string): Promise<void> {
	const project = await projectQueries.getProjectById(projectId);
	if (!project) {
		throw new HandlerError('NOT_FOUND', 'Project not found');
	}
	await deleteStoredFiles(projectId);
	await scheduledJobQueries.deleteProjectJobs(projectId);
	await projectQueries.deleteProject(projectId);
	await removeManagedProjectFolder(project.path);
}

/** Removes an organization, all of its projects, and cancels its Stripe subscription. */
export async function deleteOrganizationPermanently(orgId: string): Promise<void> {
	const organization = await orgQueries.getOrganizationById(orgId);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization not found');
	}
	await cancelOrganizationSubscription(orgId);
	for (const project of await backofficeQueries.getOrganizationProjects(orgId)) {
		await deleteProjectPermanently(project.id);
	}
	await orgQueries.deleteOrganization(orgId);
}

async function cancelOrganizationSubscription(orgId: string): Promise<void> {
	const subscriptionId = (await getOrganizationBilling(orgId))?.stripeSubscriptionId;
	if (isCloudBillingEnabled() && subscriptionId) {
		await cancelCloudSubscription(subscriptionId, orgId);
	}
}

async function deleteStoredFiles(projectId: string): Promise<void> {
	if (!isStorageEnabled()) {
		return;
	}
	const storage = getStorage();
	for (const object of await storage.list(projectRoot(projectId))) {
		await storage.delete(object.key);
	}
}

/** Only folders nao created under the projects directory are removed, never a path an admin pointed to. */
async function removeManagedProjectFolder(projectPath: string | null): Promise<void> {
	if (!projectPath) {
		return;
	}
	const projectsDirectory = path.resolve(env.NAO_PROJECTS_DIR);
	const folder = path.resolve(projectPath);
	if (path.dirname(folder) !== projectsDirectory) {
		return;
	}
	try {
		await fs.rm(folder, { recursive: true, force: true });
	} catch (error) {
		logger.error(`Failed to remove the folder of a deleted project: ${String(error)}`, {
			source: 'system',
			context: { projectPath },
		});
	}
}
