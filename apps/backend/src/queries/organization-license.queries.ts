import { eq } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

/**
 * Kept apart from `organization.queries` so `license.service` only depends on the database:
 * importing the full organization queries puts it in an import cycle that `bun build` miscompiles.
 */
export type OrganizationLicenseToken = { orgId: string; license: string | null };

export const getOrganizationLicenseToken = async (orgId: string): Promise<OrganizationLicenseToken | null> => {
	const [row] = await db
		.select({ orgId: s.organization.id, license: s.organization.license })
		.from(s.organization)
		.where(eq(s.organization.id, orgId))
		.execute();
	return row ?? null;
};

export const getProjectOrganizationLicenseToken = async (
	projectId: string,
): Promise<OrganizationLicenseToken | null> => {
	const [row] = await db
		.select({ orgId: s.organization.id, license: s.organization.license })
		.from(s.project)
		.innerJoin(s.organization, eq(s.organization.id, s.project.orgId))
		.where(eq(s.project.id, projectId))
		.execute();
	return row ?? null;
};
