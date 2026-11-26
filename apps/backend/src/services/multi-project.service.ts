/* @license Enterprise */

import { isCloud } from '../env';
import { getConfiguredProjectPaths } from '../utils/project-paths';
import { hasFeature, LICENSE_FEATURES } from './license.service';

/** A self-hosted instance runs several projects when it declares more than one path and holds the Enterprise license. */
export async function isSelfHostedMultiProjectEnabled(): Promise<boolean> {
	if (isCloud || getConfiguredProjectPaths().length <= 1) {
		return false;
	}
	return hasFeature(LICENSE_FEATURES.multiProject);
}

/** Paths of the projects a self-hosted instance serves: every configured one when licensed, else the default only. */
export async function getActiveProjectPaths(): Promise<string[]> {
	const paths = getConfiguredProjectPaths();
	if (await isSelfHostedMultiProjectEnabled()) {
		return paths;
	}
	return paths.slice(0, 1);
}
