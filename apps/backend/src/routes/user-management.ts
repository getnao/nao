import { FREE_CUSTOM_USER_GROUP_LIMIT, USER_ROLES } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod/v4';

import type { App } from '../app';
import type { DBOrganization, DBProject } from '../db/abstractSchema';
import { env } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { checkApiKey } from '../services/api-key.service';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { putOrganizationMember, putProjectMember, removeOrganizationMember } from '../services/membership.service';
import { addTeamMember } from '../services/team-member';
import { assertUserGroupManageable } from '../services/user-group-availability.service';
import type { ApiKeyScope } from '../types/api-key';
import { ORG_ROLES } from '../types/organization';
import { buildUserAddedEmail } from '../utils/email-builders';
import { HandlerError } from '../utils/error';

const USER_MANAGEMENT_SCOPE: ApiKeyScope = 'user_management';

const paginationSchema = z.object({
	search: z.string().trim().optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});
const userParamsSchema = z.object({ userId: z.string().min(1) });
const deleteUserQuerySchema = z.object({ purge: z.coerce.boolean().default(false) });
const projectParamsSchema = z.object({ projectId: z.string().min(1) });
const groupParamsSchema = projectParamsSchema.extend({ groupId: z.string().min(1) });
const groupMemberParamsSchema = groupParamsSchema.extend({ userId: z.string().min(1) });
const projectMemberParamsSchema = projectParamsSchema.extend({ userId: z.string().min(1) });
const createUserSchema = z.object({
	email: z.string().trim().min(3).max(320),
	name: z.string().trim().min(1).max(200),
	role: z.enum(ORG_ROLES).default(env.DEFAULT_USER_ROLE),
	groupIds: z.array(z.string().min(1)).max(100).default([]),
});
const updateUserSchema = z.object({ role: z.enum(ORG_ROLES) });
const groupSchema = z.object({ name: z.string().trim().min(1).max(80) });
const projectMemberSchema = z.object({ role: z.enum(USER_ROLES) });

export const userManagementRoutes = async (app: App) => {
	app.addHook('onRequest', async (request, reply) => {
		const check = await checkApiKey(readBearerToken(request), USER_MANAGEMENT_SCOPE);
		if (check.status === 'ok') {
			(request as ApiKeyRequest).apiKeyOrg = check.org;
			return;
		}
		return reply.status(check.status === 'scope_mismatch' ? 403 : 401).send({
			error:
				check.status === 'scope_mismatch'
					? 'This API key is not scoped for user management'
					: 'Invalid API key',
		});
	});

	app.get('/user-management/users', async (request, reply) => {
		const query = parse(paginationSchema, request.query, reply);
		if (!query) {
			return;
		}
		return run(reply, async () => {
			const org = requireOrg(request);
			const members = await orgQueries.listOrgMembersWithUsers(org.id);
			// ponytail: paged in memory; move to a SQL limit/offset if an org ever holds thousands of members.
			const search = query.search?.toLowerCase();
			const matching = search
				? members.filter(
						(member) =>
							member.email.toLowerCase().includes(search) || member.name.toLowerCase().includes(search),
					)
				: members;
			return { items: matching.slice(query.offset, query.offset + query.limit), total: matching.length };
		});
	});

	app.post('/user-management/users', async (request, reply) => {
		const body = parse(createUserSchema, request.body, reply);
		if (!body) {
			return;
		}
		const created = await run(reply, async () => {
			const org = requireOrg(request);
			const groupIds = await requireGroupIdsInOrg(org.id, body.groupIds);
			const existing = await userQueries.getUser({ email: body.email.toLowerCase() });
			if (existing && (await orgQueries.getOrgMember(org.id, existing.id))) {
				throw new HandlerError('CONFLICT', 'User is already a member of this organization.');
			}
			const result = await addTeamMember({
				email: body.email,
				name: body.name,
				checkExisting: async (userId) => !!(await orgQueries.getOrgMember(org.id, userId)),
				addMember: async (userId) => {
					await orgQueries.addOrgMember({ orgId: org.id, userId, role: body.role });
					await userGroupQueries.addUserGroupMemberships(groupIds, userId);
				},
				buildEmail: (user, password) => buildUserAddedEmail(user, org.name, 'organization', password),
			});
			// addTeamMember echoes DEFAULT_USER_ROLE; the membership above carries the requested role.
			return {
				user: { ...result.newUser, role: body.role },
				password: result.password ?? null,
			};
		});
		if (created === SERVICE_ERROR) {
			return;
		}
		return reply.status(201).send(created);
	});

	app.patch('/user-management/users/:userId', async (request, reply) => {
		const params = parse(userParamsSchema, request.params, reply);
		const body = parse(updateUserSchema, request.body, reply);
		if (!params || !body) {
			return;
		}
		return run(reply, async () => {
			const org = requireOrg(request);
			await requireOrgMember(org.id, params.userId);
			return putOrganizationMember(org.id, params.userId, body.role, { addIfMissing: false });
		});
	});

	app.delete('/user-management/users/:userId', async (request, reply) => {
		const params = parse(userParamsSchema, request.params, reply);
		const query = parse(deleteUserQuerySchema, request.query, reply);
		if (!params || !query) {
			return;
		}
		const removed = await run(reply, async () => {
			const org = requireOrg(request);
			await requireOrgMember(org.id, params.userId);
			await removeOrganizationMember(org.id, params.userId);
			// A removal has to mean access is gone NOW, and an invitation nobody accepted is not an
			// account at all — it IS the invitation, so the row goes with it (that is what cancels the
			// temporary password already sitting in that person's inbox).
			if (query.purge || (await userQueries.isPendingInvitation(params.userId))) {
				await userQueries.deleteUser(params.userId);
			} else {
				// purge stays opt-in: it cascades to the person's stories, which a membership sync has no
				// business doing. Killing the sessions is what makes an accepted member actually lose
				// access instead of waiting out their cookie.
				await userQueries.deleteUserSessions(params.userId);
			}
			return true;
		});
		if (removed === SERVICE_ERROR) {
			return;
		}
		return reply.status(204).send();
	});

	app.get('/user-management/projects/:projectId/groups', async (request, reply) => {
		const params = parse(projectParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return run(reply, async () => {
			const project = await requireProjectInOrg(request, params.projectId);
			return { items: await userGroupQueries.listUserGroups(project.id) };
		});
	});

	app.post('/user-management/projects/:projectId/groups', async (request, reply) => {
		const params = parse(projectParamsSchema, request.params, reply);
		const body = parse(groupSchema, request.body, reply);
		if (!params || !body) {
			return;
		}
		const created = await run(reply, async () => {
			const project = await requireProjectInOrg(request, params.projectId);
			const createGroup = (await hasFeature(LICENSE_FEATURES.userGroups))
				? userGroupQueries.createUserGroup
				: userGroupQueries.createUserGroupWithinLimit.bind(null, FREE_CUSTOM_USER_GROUP_LIMIT);
			return createGroup(project.id, body.name);
		});
		if (created === SERVICE_ERROR) {
			return;
		}
		return reply.status(201).send(created);
	});

	app.patch('/user-management/projects/:projectId/groups/:groupId', async (request, reply) => {
		const params = parse(groupParamsSchema, request.params, reply);
		const body = parse(groupSchema, request.body, reply);
		if (!params || !body) {
			return;
		}
		return run(reply, async () => {
			const project = await requireProjectInOrg(request, params.projectId);
			await assertUserGroupManageable(project.id, params.groupId);
			const group = await requireGroup(project.id, params.groupId);
			return userGroupQueries.updateUserGroup(project.id, params.groupId, {
				name: body.name,
				featureGrants: group.featureGrants,
			});
		});
	});

	app.delete('/user-management/projects/:projectId/groups/:groupId', async (request, reply) => {
		const params = parse(groupParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		const deleted = await run(reply, async () => {
			const project = await requireProjectInOrg(request, params.projectId);
			await assertUserGroupManageable(project.id, params.groupId);
			await userGroupQueries.deleteUserGroup(project.id, params.groupId);
			return true;
		});
		if (deleted === SERVICE_ERROR) {
			return;
		}
		return reply.status(204).send();
	});

	app.put('/user-management/projects/:projectId/groups/:groupId/members/:userId', async (request, reply) => {
		const params = parse(groupMemberParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return setGroupMembership(request, reply, params, true);
	});

	app.delete('/user-management/projects/:projectId/groups/:groupId/members/:userId', async (request, reply) => {
		const params = parse(groupMemberParamsSchema, request.params, reply);
		if (!params) {
			return;
		}
		return setGroupMembership(request, reply, params, false);
	});

	app.put('/user-management/projects/:projectId/members/:userId', async (request, reply) => {
		const params = parse(projectMemberParamsSchema, request.params, reply);
		const body = parse(projectMemberSchema, request.body, reply);
		if (!params || !body) {
			return;
		}
		return run(reply, async () => {
			await requireProjectInOrg(request, params.projectId);
			return putProjectMember(params.projectId, params.userId, body.role);
		});
	});
};

const SERVICE_ERROR = Symbol('service-error');

const httpStatusByCode: Record<string, number> = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
};

async function run<T>(reply: FastifyReply, operation: () => Promise<T>): Promise<T | typeof SERVICE_ERROR> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof HandlerError) {
			reply.status(error.code).send({ error: error.message });
			return SERVICE_ERROR;
		}
		if (error instanceof userGroupQueries.UserGroupQueryError || error instanceof TRPCError) {
			reply.status(httpStatusByCode[error.code] ?? 500).send({ error: error.message });
			return SERVICE_ERROR;
		}
		throw error;
	}
}

async function setGroupMembership(
	request: FastifyRequest,
	reply: FastifyReply,
	params: { projectId: string; groupId: string; userId: string },
	isMember: boolean,
): Promise<void> {
	const changed = await run(reply, async () => {
		const project = await requireProjectInOrg(request, params.projectId);
		await assertUserGroupManageable(project.id, params.groupId);
		await userGroupQueries.setUserGroupMembership(project.id, params.groupId, params.userId, isMember);
		return true;
	});
	if (changed !== SERVICE_ERROR) {
		return reply.status(204).send();
	}
}

interface ApiKeyRequest extends FastifyRequest {
	apiKeyOrg?: DBOrganization;
}

function requireOrg(request: FastifyRequest): DBOrganization {
	const org = (request as ApiKeyRequest).apiKeyOrg;
	if (!org) {
		throw new HandlerError('UNAUTHORIZED', 'Invalid API key');
	}
	return org;
}

async function requireOrgMember(orgId: string, userId: string): Promise<void> {
	if (!(await orgQueries.getOrgMember(orgId, userId))) {
		throw new HandlerError('NOT_FOUND', 'User is not a member of this organization.');
	}
}

async function requireProjectInOrg(request: FastifyRequest, projectId: string): Promise<DBProject> {
	const org = requireOrg(request);
	const project = await projectQueries.getProjectById(projectId);
	if (!project || project.orgId !== org.id) {
		throw new HandlerError('NOT_FOUND', 'Project not found');
	}
	return project;
}

async function requireGroup(projectId: string, groupId: string): Promise<userGroupQueries.UserGroup> {
	const groups = await userGroupQueries.listUserGroups(projectId);
	const group = groups.find((candidate) => candidate.id === groupId);
	if (!group) {
		throw new HandlerError('NOT_FOUND', 'User group not found');
	}
	return group;
}

async function requireGroupIdsInOrg(orgId: string, groupIds: string[]): Promise<string[]> {
	if (groupIds.length === 0) {
		return [];
	}
	const known = await userGroupQueries.filterUserGroupIdsForOrg(orgId, groupIds);
	if (known.length !== new Set(groupIds).size) {
		throw new HandlerError('BAD_REQUEST', 'One or more group ids do not belong to this organization.');
	}
	return known;
}

function readBearerToken(request: FastifyRequest): string {
	const authorization = request.headers.authorization;
	return authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function parse<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | null {
	const result = schema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	reply.status(400).send({ error: result.error.issues[0]?.message ?? 'Invalid request' });
	return null;
}
