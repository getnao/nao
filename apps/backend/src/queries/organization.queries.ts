import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';

import s, { DBOrganization, DBOrgMember, NewOrganization, NewOrgMember } from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { OrgRole } from '../types/organization';
import * as projectQueries from './project.queries';
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

export const updateGoogleSettings = async (
	orgId: string,
	settings: {
		googleClientId: string | null;
		googleClientSecret: string | null;
		googleAuthDomains: string | null;
	},
): Promise<DBOrganization> => {
	const [updated] = await db
		.update(s.organization)
		.set(settings)
		.where(eq(s.organization.id, orgId))
		.returning()
		.execute();
	return updated;
};

export const getGoogleConfig = async () => {
	const org = await getFirstOrganization();
	return {
		clientId: org?.googleClientId || env.GOOGLE_CLIENT_ID || '',
		clientSecret: org?.googleClientSecret || env.GOOGLE_CLIENT_SECRET || '',
		authDomains: org?.googleAuthDomains || env.GOOGLE_AUTH_DOMAINS || '',
		usingDbOverride: !!(org?.googleClientId && org?.googleClientSecret),
	};
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

		const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
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
 * Add a user to the default organization and project if they don't already exist.
 * Called when a new user signs up.
 * Idempotent: safe to call multiple times for the same user.
 */
export const addUserToDefaultProjectIfExists = async (userId: string): Promise<void> => {
	const org = await getFirstOrganization();
	if (!org) {
		return;
	}

	const project = await projectQueries.getDefaultProject();
	if (!project) {
		return;
	}

	const role = env.DEFAULT_USER_ROLE;

	await db.transaction(async (tx) => {
		const existingOrgMember = await tx.query.orgMember.findFirst({
			where: and(eq(s.orgMember.orgId, org.id), eq(s.orgMember.userId, userId)),
		});
		if (!existingOrgMember) {
			await tx.insert(s.orgMember).values({ orgId: org.id, userId, role }).execute();
		}

		const existingProjectMember = await tx.query.projectMember.findFirst({
			where: and(eq(s.projectMember.projectId, project.id), eq(s.projectMember.userId, userId)),
		});
		if (!existingProjectMember) {
			await tx.insert(s.projectMember).values({ projectId: project.id, userId, role }).execute();
		}
	});
};

/**
 * Cloud mode: create a personal default organization for a new user.
 * Skips if the user is already a member of any organization (e.g. invited before signup).
 */
export const initializePersonalOrganization = async (userId: string): Promise<void> => {
	const existingMembership = await getUserOrgMembership(userId);
	if (existingMembership) {
		return;
	}

	const user = await userQueries.get({ id: userId });
	const orgName = user ? `${user.name}'s Organization` : 'Personal Organization';
	const orgSlug = `org-${userId.replace(/-/g, '').slice(0, 16)}`;

	await db.transaction(async (tx) => {
		const [org] = await tx.insert(s.organization).values({ name: orgName, slug: orgSlug }).returning().execute();

		await tx.insert(s.orgMember).values({ orgId: org.id, userId, role: 'admin' }).execute();
	});
};

/**
 * Startup check: Ensures organization structure is valid.
 * - If there are users but no organization, creates one and assigns first user as org_admin
 * - If there are projects without an org, assigns them to the default org
 * - If NAO_DEFAULT_PROJECT_PATH is set, ensures a project exists for that path
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

	// Ensure a project exists for the current NAO_DEFAULT_PROJECT_PATH
	await ensureDefaultProject(org);
};

export interface OrgMemberWithUser {
	id: string;
	name: string;
	email: string;
	role: OrgRole;
}

export interface OrgProjectWithAccess {
	id: string;
	name: string;
	role: OrgRole;
	createdAt: Date;
	updatedAt: Date;
}

export const getOrgMembersWithUsers = async (orgId: string): Promise<OrgMemberWithUser[]> => {
	const rows = await db
		.select({
			id: s.orgMember.userId,
			name: s.user.name,
			email: s.user.email,
			role: s.orgMember.role,
		})
		.from(s.orgMember)
		.innerJoin(s.user, eq(s.orgMember.userId, s.user.id))
		.where(eq(s.orgMember.orgId, orgId))
		.execute();
	return rows;
};

export const getOrgProjectsWithAccess = async (orgId: string, userId: string): Promise<OrgProjectWithAccess[]> => {
	const rows = await db
		.select({
			id: s.project.id,
			name: s.project.name,
			role: sql<OrgRole>`coalesce(${s.projectMember.role}, 'viewer')`,
			createdAt: s.project.createdAt,
			updatedAt: s.project.updatedAt,
		})
		.from(s.project)
		.leftJoin(s.projectMember, and(eq(s.projectMember.projectId, s.project.id), eq(s.projectMember.userId, userId)))
		.where(eq(s.project.orgId, orgId))
		.orderBy(asc(s.project.name))
		.execute();

	return rows;
};

export const updateOrgMemberRole = async (orgId: string, userId: string, role: OrgRole): Promise<void> => {
	await db
		.update(s.orgMember)
		.set({ role })
		.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.userId, userId)))
		.execute();
};

export const removeOrgMember = async (orgId: string, userId: string): Promise<void> => {
	await db
		.delete(s.orgMember)
		.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.userId, userId)))
		.execute();
};

export const removeOrgMemberFromProjects = async (orgId: string, userId: string): Promise<void> => {
	const projects = await db.select({ id: s.project.id }).from(s.project).where(eq(s.project.orgId, orgId)).execute();

	for (const project of projects) {
		await projectQueries.removeProjectMember(project.id, userId);
	}
};

export const countOrgAdmins = async (orgId: string): Promise<number> => {
	const [result] = await db
		.select({ count: count() })
		.from(s.orgMember)
		.where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.role, 'admin')))
		.execute();
	return result?.count ?? 0;
};

/**
 * Ensures a project exists for the current NAO_DEFAULT_PROJECT_PATH.
 * When users change the project path and restart, the DB may not have a record for the new path.
 */
const ensureDefaultProject = async (org: DBOrganization): Promise<void> => {
	const projectPath = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectPath) {
		return;
	}

	const existing = await projectQueries.getProjectByPath(projectPath);
	if (existing) {
		return;
	}

	const projectName = projectPath.split('/').pop() || 'Default Project';
	const project = await projectQueries.createProject({
		name: projectName,
		type: 'local',
		path: projectPath,
		orgId: org.id,
	});

	// Add all org members to the new project
	const orgMembers = await db.select().from(s.orgMember).where(eq(s.orgMember.orgId, org.id)).execute();
	for (const member of orgMembers) {
		await projectQueries.addProjectMember({
			projectId: project.id,
			userId: member.userId,
			role: member.role,
		});
	}
};
