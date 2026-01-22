import { getProjectLlmConfigs } from '../queries/project.queries';
import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { projectRoutes } from './project.routes';
import { projectProtectedProcedure, publicProcedure, router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	project: projectRoutes,
	user: userRoutes,
	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
	getModelProvider: projectProtectedProcedure.query(async ({ ctx }) => {
		const { project } = ctx;
		const projectConfigs = project ? await getProjectLlmConfigs(project.id) : [];
		const hasAnthropic = projectConfigs.some((c) => c.provider === 'anthropic') || !!process.env.ANTHROPIC_API_KEY;
		const hasOpenai = projectConfigs.some((c) => c.provider === 'openai') || !!process.env.OPENAI_API_KEY;
		if (hasAnthropic) return 'anthropic';
		if (hasOpenai) return 'openai';
		return undefined;
	}),
});

export type TrpcRouter = typeof trpcRouter;
