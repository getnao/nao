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
import { cancelOrganizationCloudSubscriptions } from './stripe.service';

const MANAGED_PROJECT_SUBFOLDERS = ['worktrees', 'test-contexts', 'live-repositories'];

/** Removes a project with its database rows, scheduled jobs, stored files and context folder. */
export async function deleteProjectPermanently(projectId: string): Promise<void> {
	const project = await projectQueries.getProjectById(projectId);
	if (!project) {
		throw new HandlerError('NOT_FOUND', 'Project not found');
	}
	await deleteStoredFiles(projectId);
	await scheduledJobQueries.deleteProjectJobs(projectId);
	await projectQueries.deleteProject(projectId);
	await removeManagedProjectFolders(projectId, project.path);
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

/** Deletion is refused when Stripe cannot be reached, so that a deleted organization is never charged again. */
async function cancelOrganizationSubscription(orgId: string): Promise<void> {
	const billing = await getOrganizationBilling(orgId);
	if (!billing?.stripeCustomerId) {
		return;
	}
	if (!isCloudBillingEnabled()) {
		throw new HandlerError(
			'CONFLICT',
			'Cloud billing is disabled, so the Stripe subscriptions of this organization cannot be cancelled. Cancel them in Stripe first.',
		);
	}
	await cancelOrganizationCloudSubscriptions(billing.stripeCustomerId, orgId);
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

/**
 * Removes the context folder with its worktrees, test snapshots and live repository, all kept in the sibling
 * `.nao` folder. Only folders nao created under the projects directory are removed, never a path an admin pointed to.
 */
async function removeManagedProjectFolders(projectId: string, projectPath: string | null): Promise<void> {
	const projectsDirectory = path.resolve(env.NAO_PROJECTS_DIR);
	if (!projectPath || path.dirname(path.resolve(projectPath)) !== projectsDirectory) {
		return;
	}
	const naoDirectory = path.join(projectsDirectory, '.nao');
	const folders = [
		path.resolve(projectPath),
		...MANAGED_PROJECT_SUBFOLDERS.map((subfolder) => path.join(naoDirectory, subfolder, projectId)),
	];
	for (const folder of folders) {
		await fs.rm(folder, { recursive: true, force: true }).catch((error: unknown) => {
			logger.error(`Failed to remove a folder of a deleted project: ${String(error)}`, {
				source: 'system',
				context: { folder },
			});
		});
	}
}
