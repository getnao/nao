import type { UserRole } from '@nao/shared/types';
import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import superjson from 'superjson';

import { getSession } from '../auth';
import { isCloudFreeTierEnabled } from '../env';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import {
	assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess,
	assertUserCloudBillingAccess,
	type CloudEntitlement,
	getOrganizationCloudEntitlement,
	isUserReadOnlyInOrganization,
} from '../services/cloud-billing-access.service';
import { isOrganizationRoleMappingActive } from '../services/sso-group-mapping.service';
import { canSeeAdvancedSettings } from '../services/user-group-feature-access.service';
import { HandlerError } from '../utils/error';
import { convertHeaders } from '../utils/utils';

export type Context = Awaited<ReturnType<typeof createContext>>;
export type MiddlewareFunction = Parameters<typeof t.procedure.use>[0];

export const createContext = async (opts: CreateFastifyContextOptions) => {
	const headers = convertHeaders(opts.req.headers);
	const session = await getSession(headers);
	return {
		session,
		selectedProjectId: headers.get('x-nao-project-id'),
		selectedOrganizationId: headers.get('x-nao-organization-id'),
	};
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		const cause = error.cause as (Error & Record<string, unknown>) | undefined;
		const conflictingProjectName =
			typeof cause?.conflictingProjectName === 'string' ? cause.conflictingProjectName : undefined;
		return {
			...shape,
			data: {
				...shape.data,
				...(conflictingProjectName ? { conflictingProjectName } : {}),
			},
		};
	},
});

export const router = t.router;

type CloudBillingScope = {
	projectId?: string;
	organizationId?: string | null;
};

export function cloudBillingMiddleware<TContext, TInput = unknown>(
	resolveScope: (ctx: TContext, rawInput: TInput) => CloudBillingScope | null | Promise<CloudBillingScope | null>,
) {
	return t.middleware(async ({ ctx, getRawInput, next }) => {
		const scope = await resolveScope(ctx as TContext, (await getRawInput()) as TInput);
		if (!scope) {
			return next();
		}
		const sessionUserId = (ctx as { session?: { user?: { id: string } } | null }).session?.user?.id;
		const cachedEntitlement = getCachedCloudEntitlement(ctx, scope.organizationId);
		if (scope.organizationId) {
			const entitlement =
				cachedEntitlement ??
				(sessionUserId ? await getOrganizationCloudEntitlement(scope.organizationId) : undefined);
			if (entitlement) {
				await assertOrganizationCloudBillingAccess(scope.organizationId, entitlement);
			} else {
				await assertOrganizationCloudBillingAccess(scope.organizationId);
			}
			if (sessionUserId) {
				await assertUserCloudBillingAccess(scope.organizationId, sessionUserId, entitlement);
			}
			return next({
				ctx: {
					billingAccessVerifiedProjectId: scope.projectId,
					cloudEntitlement: entitlement,
					cloudEntitlementOrganizationId: scope.organizationId,
				},
			});
		} else if (scope.projectId) {
			if (sessionUserId) {
				const project = await projectQueries.getProjectById(scope.projectId);
				if (!project?.orgId) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Cloud billing organization was not found' });
				}
				const entitlement = await getOrganizationCloudEntitlement(project.orgId);
				await assertOrganizationCloudBillingAccess(project.orgId, entitlement);
				await assertUserCloudBillingAccess(project.orgId, sessionUserId, entitlement);
				return next({
					ctx: {
						billingAccessVerifiedProjectId: scope.projectId,
						cloudEntitlement: entitlement,
						cloudEntitlementOrganizationId: project.orgId,
					},
				});
			}
			await assertProjectCloudBillingAccess(scope.projectId);
		} else {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Cloud billing organization was not found' });
		}
		return next({ ctx: { billingAccessVerifiedProjectId: scope.projectId } });
	});
}

// Map HandlerError to tRPC error
const withHandlerErrors = t.middleware(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		if (error instanceof HandlerError) {
			throw new TRPCError({ code: error.codeMessage, message: error.message });
		}
		throw error;
	}
});

export const publicProcedure = t.procedure.use(withHandlerErrors);

export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}

	return next({ ctx: { user: ctx.session.user } });
});

export async function resolveOrganizationMembership(
	userId: string,
	selectedProjectId: string | null,
	selectedOrganizationId?: string | null,
) {
	if (selectedOrganizationId) {
		const membership = await orgQueries.getUserOrgMembership(userId, selectedOrganizationId);
		if (!membership) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
		}
		return membership;
	}

	if (selectedProjectId) {
		const membership = await orgQueries.getUserOrgMembershipByProject(userId, selectedProjectId);
		if (!membership) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Selected project organization was not found' });
		}
		return membership;
	}

	const membership = await orgQueries.getUserOrgMembership(userId);
	if (!membership) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
	}
	return membership;
}

export const projectProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const project = await projectQueries.getProjectByUserId(ctx.user.id, ctx.selectedProjectId);
	if (!project) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project configured' });
	}
	const storedUserRole: UserRole | null = await projectQueries.getUserRoleInProject(project.id, ctx.user.id);
	const { cloudEntitlement, userRole } = await resolveEffectiveProjectAccess(
		project.orgId,
		ctx.user.id,
		storedUserRole,
	);

	return next({
		ctx: {
			project,
			userRole,
			cloudEntitlement,
			cloudEntitlementOrganizationId: project.orgId,
		},
	});
});

const selectedProjectBillingMiddleware = cloudBillingMiddleware<{
	project: { id: string; orgId: string | null };
}>(({ project }) => ({ projectId: project.id, organizationId: project.orgId }));

export const cloudBillingProjectProcedure = projectProtectedProcedure.use(selectedProjectBillingMiddleware);

/** Grants project access to admins, users, and context admins. */
export const nonViewerProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.userRole !== 'admin' && ctx.userRole !== 'user' && ctx.userRole !== 'context_admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot access this resource' });
	}

	return next({ ctx });
});

export const cloudBillingNonViewerProcedure = nonViewerProtectedProcedure.use(selectedProjectBillingMiddleware);

export const canSendProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.userRole !== 'admin' && ctx.userRole !== 'user' && ctx.userRole !== 'context_admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot perform this action' });
	}

	return next({ ctx });
});

export const cloudBillingCanSendProcedure = canSendProcedure.use(selectedProjectBillingMiddleware);

export function resourceProjectProcedure<T extends { projectId: string }>(
	inputField: string,
	fetch: (id: string) => Promise<T | null>,
	label: string,
	checkAccess?: (resource: T, userId: string) => Promise<boolean>,
) {
	return protectedProcedure.use(async ({ ctx, getRawInput, next }) => {
		const rawInput = (await getRawInput()) as Record<string, unknown>;
		const resourceId = rawInput[inputField];
		if (typeof resourceId !== 'string') {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `${inputField} is required.` });
		}

		const resource = await fetch(resourceId);
		if (!resource) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `${label} not found.` });
		}

		const storedUserRole: UserRole | null = await projectQueries.getUserRoleInProject(
			resource.projectId,
			ctx.user.id,
		);
		if (!storedUserRole) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this project.' });
		}
		const project = await projectQueries.getProjectById(resource.projectId);
		const { cloudEntitlement, userRole } = await resolveEffectiveProjectAccess(
			project?.orgId ?? null,
			ctx.user.id,
			storedUserRole,
		);

		if (checkAccess) {
			const canAccess = await checkAccess(resource, ctx.user.id);
			if (!canAccess) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `You do not have access to this ${label.toLowerCase()}.`,
				});
			}
		}

		return next({
			ctx: {
				resource,
				userRole,
				cloudEntitlement,
				cloudEntitlementOrganizationId: project?.orgId ?? null,
			},
		});
	});
}

export const adminProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can perform this action' });
	}

	return next({ ctx: { project: ctx.project, userRole: ctx.userRole } });
});

export const cloudBillingAdminProcedure = adminProtectedProcedure.use(selectedProjectBillingMiddleware);

/**
 * Grants access to admins and context admins. Context admins use nao like regular users but
 * additionally manage observability surfaces: chat replay and context recommendations.
 */
export const contextAdminProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.userRole !== 'admin' && ctx.userRole !== 'context_admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins or context admins can perform this action' });
	}

	return next({ ctx: { project: ctx.project, userRole: ctx.userRole } });
});

export const cloudBillingContextAdminProcedure = contextAdminProtectedProcedure.use(selectedProjectBillingMiddleware);

/** Grants the settings pages beyond the user's own account: the User role needs a group showing all settings. */
export const advancedSettingsProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (!(await canSeeAdvancedSettings(ctx.project.id, ctx.user.id, ctx.userRole))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Advanced settings are not enabled for your user group.' });
	}

	return next({ ctx });
});

export const organizationProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const membership = await resolveOrganizationMembership(
		ctx.user.id,
		ctx.selectedProjectId,
		ctx.selectedOrganizationId,
	);
	return next({ ctx: { organization: membership.organization, orgRole: membership.role } });
});

export const cloudBillingProjectImportProcedure = organizationProtectedProcedure.use(async ({ ctx, next }) => {
	if (await projectQueries.organizationHasProjects(ctx.organization.id)) {
		const entitlement = await getOrganizationCloudEntitlement(ctx.organization.id);
		await assertOrganizationCloudBillingAccess(ctx.organization.id, entitlement);
		await assertUserCloudBillingAccess(ctx.organization.id, ctx.user.id, entitlement);
	}
	return next({ ctx });
});

/** Organization roles mapped from identity provider groups are re-applied on every sign-in. */
export async function assertOrganizationRolesAreEditable(): Promise<void> {
	if (await isOrganizationRoleMappingActive()) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Organization roles are managed by your identity provider and cannot be changed here.',
		});
	}
}

/**
 * Account-wide user data (name, messaging linking code, SSO token) is shared by every organization the
 * user belongs to, so an admin may only act on it when the user belongs to nothing outside the admin's
 * organization. Everyone can act on their own account.
 */
export async function assertCanManageUserAccount(
	actorUserId: string,
	targetUserId: string,
	orgId: string | null,
	action: string,
) {
	if (actorUserId === targetUserId || (await userQueries.isUserConfinedToOrganization(targetUserId, orgId))) {
		return;
	}
	throw new TRPCError({
		code: 'FORBIDDEN',
		message: `This user also belongs to another organization, so only they can ${action}.`,
	});
}

export async function assertCanRenameUser(actorUserId: string, targetUserId: string, orgId: string | null) {
	await assertCanManageUserAccount(actorUserId, targetUserId, orgId, 'change their name');
}

export function ownedResourceProcedure(
	getOwnerId: (resourceId: string) => Promise<string | undefined>,
	resourceName: string,
) {
	return protectedProcedure.use(async ({ ctx, getRawInput, next }) => {
		const rawInput = (await getRawInput()) as Record<string, unknown>;
		const resourceId = rawInput[`${resourceName}Id`];
		if (typeof resourceId !== 'string') {
			throw new TRPCError({ code: 'BAD_REQUEST', message: `${resourceName}Id is required.` });
		}

		const ownerId = await getOwnerId(resourceId);
		if (!ownerId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `${resourceName} not found.` });
		}
		if (ownerId !== ctx.user.id) {
			throw new TRPCError({
				code: 'FORBIDDEN',
				message: `You are not authorized to modify this ${resourceName}.`,
			});
		}

		return next({ ctx });
	});
}

function getCachedCloudEntitlement(ctx: unknown, organizationId?: string | null): CloudEntitlement | undefined {
	const cached = ctx as {
		cloudEntitlement?: CloudEntitlement | null;
		cloudEntitlementOrganizationId?: string | null;
	};
	return cached.cloudEntitlementOrganizationId === organizationId
		? (cached.cloudEntitlement ?? undefined)
		: undefined;
}

async function resolveEffectiveProjectAccess(
	organizationId: string | null,
	userId: string,
	storedUserRole: UserRole | null,
): Promise<{ cloudEntitlement: CloudEntitlement | undefined; userRole: UserRole | null }> {
	if (!organizationId || !storedUserRole || !isCloudFreeTierEnabled()) {
		return { cloudEntitlement: undefined, userRole: storedUserRole };
	}
	const cloudEntitlement = await getOrganizationCloudEntitlement(organizationId);
	const isReadOnly = await isUserReadOnlyInOrganization(organizationId, userId, cloudEntitlement);
	return { cloudEntitlement: cloudEntitlement ?? undefined, userRole: isReadOnly ? 'viewer' : storedUserRole };
}
