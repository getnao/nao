import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import superjson from 'superjson';

import { getAuth } from '../auth';
import * as projectQueries from '../queries/project.queries';
import type { UserRole } from '../types/project';
import { HandlerError } from '../utils/error';
import { convertHeaders } from '../utils/utils';

export type Context = Awaited<ReturnType<typeof createContext>>;
export type MiddlewareFunction = Parameters<typeof t.procedure.use>[0];

export const createContext = async (opts: CreateFastifyContextOptions) => {
	const headers = convertHeaders(opts.req.headers);
	const auth = await getAuth();
	const session = await auth?.api.getSession({ headers });
	return {
		session,
	};
};

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
	transformer: superjson,
});

export const router = t.router;

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

export const projectProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const project = await projectQueries.getProjectByUserId(ctx.user.id);
	if (!project) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project configured' });
	}
	const userRole: UserRole | null = await projectQueries.getUserRoleInProject(project.id, ctx.user.id);

	return next({ ctx: { project, userRole } });
});

export const adminProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (ctx.userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can perform this action' });
	}

	return next({ ctx: { project: ctx.project, userRole: ctx.userRole } });
});

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
