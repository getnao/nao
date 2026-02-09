import { accountRoutes } from './account.routes';
import { chatRoutes } from './chat.routes';
import { feedbackRoutes } from './feedback.routes';
import { googleRoutes } from './google.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { router } from './trpc';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	chat: chatRoutes,
	feedback: feedbackRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	user: userRoutes,
	google: googleRoutes,
	account: accountRoutes,
});

export type TrpcRouter = typeof trpcRouter;
