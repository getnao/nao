import { accountRoutes } from './account.routes';
import { apiKeyRoutes } from './api-key.routes';
import { authConfigRoutes } from './auth-config.routes';
import { budgetRoutes } from './budget.routes';
import { chartRoutes } from './chart.routes';
import { chatRoutes } from './chat.routes';
import { chatForkRoutes } from './chat-fork.routes';
import { citationRoutes } from './citation.routes';
import { contextExplorerRoutes } from './context-explorer.routes';
import { feedbackRoutes } from './feedback.routes';
import { githubRoutes } from './github.routes';
import { logRoutes } from './log.routes';
import { mcpRoutes } from './mcp.routes';
import { memoryRoutes } from './memory.routes';
import { organizationRoutes } from './organization.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { sharedChatRoutes } from './shared-chat.routes';
import { sharedStoryRoutes } from './shared-story.routes';
import { skillRoutes } from './skill.routes';
import { storyRoutes } from './story.routes';
import { systemRoutes } from './system.routes';
import { transcribeRoutes } from './transcribe.routes';
import { router } from './trpc';
import { usageRoutes } from './usage.routes';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	budget: budgetRoutes,
	chart: chartRoutes,
	chat: chatRoutes,
	sharedChat: sharedChatRoutes,
	chatFork: chatForkRoutes,
	citation: citationRoutes,
	contextExplorer: contextExplorerRoutes,
	feedback: feedbackRoutes,
	github: githubRoutes,
	log: logRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	storyShare: sharedStoryRoutes,
	story: storyRoutes,
	usage: usageRoutes,
	user: userRoutes,
	memory: memoryRoutes,
	organization: organizationRoutes,
	authConfig: authConfigRoutes,
	account: accountRoutes,
	apiKey: apiKeyRoutes,
	mcp: mcpRoutes,
	system: systemRoutes,
	skill: skillRoutes,
	transcribe: transcribeRoutes,
});

export type TrpcRouter = typeof trpcRouter;
