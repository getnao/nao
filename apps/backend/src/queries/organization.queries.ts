import { and, eq, isNull } from 'drizzle-orm';

import s, { DBOrganization, DBOrgMember, NewOrganization, NewOrgMember } from '../db/abstractSchema';
import { db } from '../db/db';
import { OrgRole } from '../types/organization';
import * as userQueries from './user.queries';

export const getOrganizationById = async (id: string): Promise<DBOrganization | null> => {
	const [org] = await db.select().from(s.organization).where(eq(s.organization.id, id)).execute();
	return org ?? null;
};

export const getFirstOrganization = async (): Promise<DBOrganization | null> => {
	const [org] = await db.select().from(s.organization).limit(1).execute();
	return org ?? null;
};

export const createOrganization = async (org: NewOrganization): Promise<DBOrganization> => {
	const [created] = await db.insert(s.organization).values(org).returning().execute();
	return created;
};

export const getOrgMember = async (orgId: string, userId: string): Promise<DBOrgMember | null> => {
	const [member] = await db
		.select()
		.from(s.orgMember)
		.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.userId, userId)))
		.execute();
	return member ?? null;
};

export const addOrgMember = async (member: NewOrgMember): Promise<DBOrgMember> => {
	const [created] = await db.insert(s.orgMember).values(member).returning().execute();
	return created;
};

export const getUserOrgMembership = async (
	userId: string,
): Promise<(DBOrgMember & { organization: DBOrganization }) | null> => {
	const [result] = await db
		.select({
			orgId: s.orgMember.orgId,
			userId: s.orgMember.userId,
			role: s.orgMember.role,
			createdAt: s.orgMember.createdAt,
			organization: s.organization,
		})
		.from(s.orgMember)
		.innerJoin(s.organization, eq(s.orgMember.orgId, s.organization.id))
		.where(eq(s.orgMember.userId, userId))
		.limit(1)
		.execute();
	return result ?? null;
};

export const getUserRoleInOrg = async (orgId: string, userId: string): Promise<OrgRole | null> => {
	const member = await getOrgMember(orgId, userId);
	return member?.role ?? null;
};

export const getOrCreateDefaultOrganization = async (): Promise<DBOrganization> => {
	const existing = await getFirstOrganization();
	if (existing) {
		return existing;
	}

	return createOrganization({
		name: 'Default Organization',
		slug: 'default',
	});
};

/**
 * Initialize default organization and project for the first user.
 * Creates the organization, adds the user as admin, and creates the default project.
 * All operations are wrapped in a transaction.
 */
export const initializeDefaultOrganizationForFirstUser = async (userId: string): Promise<void> => {
	const userCount = await userQueries.countAll();
	if (userCount !== 1) {
		return;
	}

	const existingOrg = await getFirstOrganization();
	if (existingOrg) {
		return;
	}

	await db.transaction(async (tx) => {
		// Create organization
		const [org] = await tx
			.insert(s.organization)
			.values({ name: 'Default Organization', slug: 'default' })
			.returning()
			.execute();

		// Add user as org admin
		await tx.insert(s.orgMember).values({ orgId: org.id, userId, role: 'admin' }).execute();

		// Create default project if path is configured
		const projectPath = process.env.NAO_DEFAULT_PROJECT_PATH;
		if (projectPath) {
			const [existingProject] = await tx
				.select()
				.from(s.project)
				.where(eq(s.project.path, projectPath))
				.execute();

			if (!existingProject) {
				const projectName = projectPath.split('/').pop() || 'Default Project';
				const [project] = await tx
					.insert(s.project)
					.values({ name: projectName, type: 'local', path: projectPath, orgId: org.id })
					.returning()
					.execute();

				await tx.insert(s.projectMember).values({ projectId: project.id, userId, role: 'admin' }).execute();
			}
		}
	});
};

/**
 * Startup check: Ensures organization structure is valid.
 * - If there are users but no organization, creates one and assigns first user as org_admin
 * - If there are projects without an org, assigns them to the default org
 */
export const ensureOrganizationSetup = async (): Promise<void> => {
	const firstUser = await userQueries.getFirst();
	if (!firstUser) {
		return; // No users yet, nothing to do
	}

	// Check if there's an organization
	let org = await getFirstOrganization();

	if (!org) {
		// Create default organization
		org = await createOrganization({
			name: 'Default Organization',
			slug: 'default',
		});

		// Add first user as org_admin
		await addOrgMember({
			orgId: org.id,
			userId: firstUser.id,
			role: 'admin',
		});
	}

	// Check if first user is a member of the org
	const membership = await getOrgMember(org.id, firstUser.id);
	if (!membership) {
		await addOrgMember({
			orgId: org.id,
			userId: firstUser.id,
			role: 'admin',
		});
	}

	// Assign any orphaned projects (projects without org) to the default org
	await db.update(s.project).set({ orgId: org.id }).where(isNull(s.project.orgId)).execute();
};
