import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { googleRoutes } from './google.routes';
import { projectRoutes } from './project.routes';
import { router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	project: projectRoutes,
	user: userRoutes,
	google: googleRoutes,
});

export type TrpcRouter = typeof trpcRouter;
