import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { projectRoutes } from './project.routes';
import { publicProcedure, router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	project: projectRoutes,
	user: userRoutes,
	hasGoogleSetup: publicProcedure.query(() => {
		return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
	}),
});

export type TrpcRouter = typeof trpcRouter;
