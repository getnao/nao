import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import superjson from 'superjson';

import { auth } from '../auth';
import * as projectQueries from '../queries/project.queries';
import type { UserRole } from '../types/project';
import { convertHeaders } from '../utils/utils';

export type Context = Awaited<ReturnType<typeof createContext>>;
export type MiddlewareFunction = Parameters<typeof t.procedure.use>[0];

export const createContext = async (opts: CreateFastifyContextOptions) => {
	const headers = convertHeaders(opts.req.headers);
	const session = await auth.api.getSession({ headers });
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

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}

	return next({ ctx: { user: ctx.session.user } });
});

export const projectProtectedProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const project = await projectQueries.checkUserHasProject(ctx.user.id);
	const userRole: UserRole | null = project
		? await projectQueries.getUserRoleInProject(project.id, ctx.user.id)
		: null;

	return next({ ctx: { project, userRole } });
});

export const adminProtectedProcedure = projectProtectedProcedure.use(async ({ ctx, next }) => {
	if (!ctx.project) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project configured' });
	}
	if (ctx.userRole !== 'admin') {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can perform this action' });
	}

	return next({ ctx: { project: ctx.project, userRole: ctx.userRole } });
});
