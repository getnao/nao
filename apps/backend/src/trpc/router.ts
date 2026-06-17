import { accountRoutes } from './account.routes';
import { apiKeyRoutes } from './api-key.routes';
import { authConfigRoutes } from './auth-config.routes';
import { automationRoutes } from './automation.routes';
import { brandingRoutes } from './branding.routes';
import { budgetRoutes } from './budget.routes';
import { chartRoutes } from './chart.routes';
import { chatRoutes } from './chat.routes';
import { chatForkRoutes } from './chat-fork.routes';
import { citationRoutes } from './citation.routes';
import { contextExplorerRoutes } from './context-explorer.routes';
import { contextRecommendationRoutes } from './context-recommendation.routes';
import { embedRoutes } from './embed.routes';
import { favoriteRoutes } from './favorite.routes';
import { feedbackRoutes } from './feedback.routes';
import { githubRoutes } from './github.routes';
import { licenseRoutes } from './license.routes';
import { logRoutes } from './log.routes';
import { mcpRoutes } from './mcp.routes';
import { mcpEndpointRoutes } from './mcp-endpoint.routes';
import { memoryRoutes } from './memory.routes';
import { organizationRoutes } from './organization.routes';
import { posthogRoutes } from './posthog.routes';
import { projectRoutes } from './project.routes';
import { sharedChatRoutes } from './shared-chat.routes';
import { sharedStoryRoutes } from './shared-story.routes';
import { skillRoutes } from './skill.routes';
import { storyRoutes } from './story.routes';
import { storyFolderRoutes } from './story-folder.routes';
import { systemRoutes } from './system.routes';
import { transcribeRoutes } from './transcribe.routes';
import { router } from './trpc';
import { usageRoutes } from './usage.routes';
import { userRoutes } from './user.routes';

export const trpcRouter = router({
	branding: brandingRoutes,
	budget: budgetRoutes,
	embed: embedRoutes,
	chart: chartRoutes,
	chat: chatRoutes,
	sharedChat: sharedChatRoutes,
	automation: automationRoutes,
	chatFork: chatForkRoutes,
	citation: citationRoutes,
	contextExplorer: contextExplorerRoutes,
	contextRecommendation: contextRecommendationRoutes,
	favorite: favoriteRoutes,
	feedback: feedbackRoutes,
	github: githubRoutes,
	license: licenseRoutes,
	log: logRoutes,
	posthog: posthogRoutes,
	project: projectRoutes,
	storyShare: sharedStoryRoutes,
	story: storyRoutes,
	storyFolder: storyFolderRoutes,
	usage: usageRoutes,
	user: userRoutes,
	memory: memoryRoutes,
	organization: organizationRoutes,
	authConfig: authConfigRoutes,
	account: accountRoutes,
	apiKey: apiKeyRoutes,
	mcp: mcpRoutes,
	mcpEndpoint: mcpEndpointRoutes,
	system: systemRoutes,
	skill: skillRoutes,
	transcribe: transcribeRoutes,
});

export type TrpcRouter = typeof trpcRouter;
