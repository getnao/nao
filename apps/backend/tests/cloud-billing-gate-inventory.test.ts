import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

type PrincipalPolicy = 'actor' | 'owner' | 'organization' | 'cached_read';

const rawRoutePolicies = {
	agentRoutes: 'actor',
	attachmentRoutes: 'actor',
	analyticsRoutes: 'cached_read',
	testRoutes: 'actor',
	cliAuthRoutes: 'cached_read',
	chartRoutes: 'cached_read',
	mapBoundariesRoutes: 'cached_read',
	imageRoutes: 'cached_read',
	brandingRoutes: 'cached_read',
	authErrorRedirectRoutes: 'cached_read',
	embedStoryDownloadRoutes: 'cached_read',
	storyThumbnailRoutes: 'cached_read',
	notificationUnsubscribeRoutes: 'cached_read',
	authRoutes: 'actor',
	ssoRoutes: 'actor',
	slackRoutes: 'actor',
	teamsRoutes: 'actor',
	telegramRoutes: 'actor',
	mattermostRoutes: 'actor',
	discordRoutes: 'actor',
	whatsappRoutes: 'actor',
	stripeWebhookRoutes: 'organization',
	deployRoutes: 'organization',
	backofficeRoutes: 'organization',
	automationWebhookRoutes: 'owner',
	githubRoutes: 'actor',
	gitlabRoutes: 'actor',
	mcpOAuthRoutes: 'cached_read',
	mcpServerRoutes: 'actor',
} as const satisfies Record<string, PrincipalPolicy>;

const jobPolicies = {
	LOG_CLEANUP_JOB_NAME: 'cached_read',
	INVITATION_CLEANUP_JOB_NAME: 'cached_read',
	AUTOMATION_JOB_NAME: 'owner',
	STORY_REFRESH_JOB_NAME: 'owner',
	STORY_DELIVERY_JOB_NAME: 'owner',
	MANAGED_CREDIT_LIFECYCLE_JOB_NAME: 'organization',
	STRIPE_WEBHOOK_PROCESS_JOB_NAME: 'organization',
	BILLING_LIFECYCLE_JOB_NAME: 'organization',
	CLOUD_TRIAL_PROVISIONING_JOB_NAME: 'organization',
	MCP_QUERY_DATA_CLEANUP_JOB_NAME: 'cached_read',
	STORY_BLOB_CLEANUP_JOB_NAME: 'cached_read',
	CONTEXT_BRANCH_CLEANUP_JOB_NAME: 'cached_read',
	CONTEXT_RECOMMENDATIONS_JOB_NAME: 'owner',
} as const satisfies Record<string, PrincipalPolicy>;

const messagingPolicies = {
	slack: 'actor',
	teams: 'actor',
	telegram: 'actor',
	mattermost: 'actor',
	discord: 'actor',
	whatsapp: 'actor',
} as const satisfies Record<string, PrincipalPolicy>;

const costProducingTrpcPolicies = [
	['github.routes.ts', 'createProjectFromRepo', 'actor'],
	['gitlab.routes.ts', 'createProjectFromRepo', 'actor'],
	['sql.routes.ts', 'previewQuery', 'actor'],
	['sql.routes.ts', 'updateQuery', 'actor'],
	['story.routes.ts', 'refreshData', 'actor'],
	['story.routes.ts', 'getLiveQueryData', 'actor'],
	['story.routes.ts', 'getFilterOptions', 'actor'],
	['story.routes.ts', 'getFilteredQueryData', 'actor'],
	['story.routes.ts', 'parseCronFromText', 'actor'],
	['shared-story.routes.ts', 'getCustomStoryQueryData', 'cached_read'],
	['shared-story.routes.ts', 'getCustomStoryNarratives', 'cached_read'],
	['shared-story.routes.ts', 'setCustomStoryState', 'actor'],
	['shared-story.routes.ts', 'getLiveQueryData', 'actor'],
	['shared-story.routes.ts', 'getFilterOptions', 'actor'],
	['shared-story.routes.ts', 'getFilteredQueryData', 'actor'],
	['shared-story.routes.ts', 'refreshData', 'actor'],
	['custom-story-viewer.routes.ts', 'getQueryData', 'cached_read'],
	['custom-story-viewer.routes.ts', 'getNarratives', 'cached_read'],
	['custom-story-viewer.routes.ts', 'setState', 'actor'],
	['automation.routes.ts', 'runNow', 'actor'],
	['automation.routes.ts', 'parseCronFromText', 'actor'],
	['chat-fork.routes.ts', 'fork', 'actor'],
	['chat-fork.routes.ts', 'askSharedChat', 'actor'],
	['chat-fork.routes.ts', 'askStory', 'actor'],
	['chat-fork.routes.ts', 'forkStory', 'actor'],
	['context-recommendation.routes.ts', 'run', 'actor'],
	['context-recommendation.routes.ts', 'createPullRequest', 'actor'],
	['context-recommendation.routes.ts', 'createBatchPullRequest', 'actor'],
	['onboarding.routes.ts', 'validateWarehouseCredentials', 'actor'],
	['onboarding.routes.ts', 'startWarehouseProvisioning', 'actor'],
	['story-theme.routes.ts', 'generate', 'actor'],
	['transcribe.routes.ts', 'transcribe', 'actor'],
	['context-explorer.routes.ts', 'pullLiveContext', 'actor'],
	['context-explorer.routes.ts', 'connectRepository', 'actor'],
	['context-explorer.routes.ts', 'writeFile', 'actor'],
	['context-explorer.routes.ts', 'updateWorktree', 'actor'],
	['context-explorer.routes.ts', 'switchBranch', 'actor'],
	['context-explorer.routes.ts', 'createBranch', 'actor'],
	['context-explorer.routes.ts', 'createBranchAndCommit', 'actor'],
	['context-explorer.routes.ts', 'commitChanges', 'actor'],
	['context-explorer.routes.ts', 'pushBranch', 'actor'],
] as const satisfies readonly (readonly [string, string, PrincipalPolicy])[];

describe('cloud billing execution gate inventory', () => {
	it('classifies every registered raw route module', () => {
		const appSource = source('../src/app.ts');
		const registeredRouteModules = [...appSource.matchAll(/\bapp\.register\(\s*([A-Za-z]\w*Routes)\b/g)].map(
			(match) => match[1],
		);

		expect([...new Set(registeredRouteModules)].sort()).toEqual(Object.keys(rawRoutePolicies).sort());
	});

	it('classifies every registered scheduler job', () => {
		const appSource = source('../src/app.ts');
		const registeredJobs = [...appSource.matchAll(/\bregisterJob\(\s*([A-Z][A-Z0-9_]*JOB_NAME)\b/g)].map(
			(match) => match[1],
		);

		expect([...new Set(registeredJobs)].sort()).toEqual(Object.keys(jobPolicies).sort());
	});

	it('classifies every messaging integration', () => {
		const appSource = source('../src/app.ts');
		for (const provider of Object.keys(messagingPolicies)) {
			expect(appSource).toContain(`app.register(${provider}Routes`);
			expect(source(`../src/services/${provider}.ts`)).toContain('assertMessagingUserCloudBillingAccess');
		}
	});

	it('keeps cost-producing tRPC procedures declared', () => {
		for (const [file, procedure] of costProducingTrpcPolicies) {
			expect(source(`../src/trpc/${file}`)).toMatch(new RegExp(`\\b${procedure}\\s*:`));
		}
	});
});

function source(relativePath: string): string {
	return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
