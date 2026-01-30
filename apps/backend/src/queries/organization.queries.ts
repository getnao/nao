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
	});
};

/**
 * Initialize default organization for the first user.
 * Creates the organization and adds the user as org_admin.
 * Returns the organization, or null if not the first user.
 */
export const initializeDefaultOrganizationForFirstUser = async (userId: string): Promise<DBOrganization | null> => {
	const userCount = await userQueries.countAll();
	if (userCount !== 1) {
		return null;
	}

	const existingOrg = await getFirstOrganization();
	if (existingOrg) {
		return null;
	}

	const org = await createOrganization({
		name: 'Default Organization',
	});

	await addOrgMember({
		orgId: org.id,
		userId,
		role: 'org_admin',
	});

	return org;
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
		});

		// Add first user as org_admin
		await addOrgMember({
			orgId: org.id,
			userId: firstUser.id,
			role: 'org_admin',
		});
	}

	// Check if first user is a member of the org
	const membership = await getOrgMember(org.id, firstUser.id);
	if (!membership) {
		await addOrgMember({
			orgId: org.id,
			userId: firstUser.id,
			role: 'org_admin',
		});
	}

	// Assign any orphaned projects (projects without org) to the default org
	await db.update(s.project).set({ orgId: org.id }).where(isNull(s.project.orgId)).execute();
};
