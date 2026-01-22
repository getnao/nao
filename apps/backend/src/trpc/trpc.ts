import { initTRPC, TRPCError } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import superjson from 'superjson';

import { auth } from '../auth';
import { ensureDefaultProjectMembership, getProjectLlmConfigs, getUserRoleInProject } from '../queries/project.queries';
import { convertHeaders } from '../utils/utils';

export type Context = Awaited<ReturnType<typeof createContext>>;
export type MiddlewareFunction = Parameters<typeof t.procedure.use>[0];

export type ConfiguredProviders = {
	anthropic: boolean;
	openai: boolean;
};

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

export type UserRole = 'admin' | 'user' | 'viewer';

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.session?.user) {
		throw new TRPCError({ code: 'UNAUTHORIZED' });
	}

	const user = ctx.session.user;
	const project = await ensureDefaultProjectMembership(user.id);

	// Build configured providers from project LLM configs and env vars (without leaking keys)
	const projectConfigs = project ? await getProjectLlmConfigs(project.id) : [];
	const configuredProviders: ConfiguredProviders = {
		anthropic: projectConfigs.some((c) => c.provider === 'anthropic') || !!process.env.ANTHROPIC_API_KEY,
		openai: projectConfigs.some((c) => c.provider === 'openai') || !!process.env.OPENAI_API_KEY,
	};

	// Get user's role in the project
	const userRole: UserRole | null = project ? await getUserRoleInProject(project.id, user.id) : null;

	return next({ ctx: { user, project, configuredProviders, userRole } });
});
