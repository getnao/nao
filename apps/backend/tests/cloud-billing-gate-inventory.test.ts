import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

type TrpcExecutionPolicy = 'actor' | 'cached_read';

const rawRouteModules = [
	'agentRoutes',
	'attachmentRoutes',
	'analyticsRoutes',
	'testRoutes',
	'cliAuthRoutes',
	'chartRoutes',
	'mapBoundariesRoutes',
	'imageRoutes',
	'brandingRoutes',
	'authErrorRedirectRoutes',
	'embedStoryDownloadRoutes',
	'storyThumbnailRoutes',
	'notificationUnsubscribeRoutes',
	'authRoutes',
	'ssoRoutes',
	'slackRoutes',
	'teamsRoutes',
	'telegramRoutes',
	'mattermostRoutes',
	'discordRoutes',
	'whatsappRoutes',
	'stripeWebhookRoutes',
	'deployRoutes',
	'backofficeRoutes',
	'automationWebhookRoutes',
	'githubRoutes',
	'gitlabRoutes',
	'mcpOAuthRoutes',
	'mcpServerRoutes',
] as const;

const rawRouteGateEvidence = {
	agentRoutes: [
		['../src/routes/agent.ts', 'authorizeAgentRun'],
		['../src/services/agent-run.ts', 'assertProjectActorCloudBillingAccess'],
	],
	attachmentRoutes: [['../src/routes/attachment.ts', 'assertProjectActorCloudBillingAccess']],
	testRoutes: [['../src/routes/test.ts', 'assertProjectActorCloudBillingAccess']],
	automationWebhookRoutes: [['../src/routes/automation-webhook.ts', 'assertProjectActorCloudBillingAccess']],
	mcpServerRoutes: [['../src/mcp/routes.ts', 'assertProjectActorCloudBillingAccess']],
} as const satisfies Partial<Record<(typeof rawRouteModules)[number], readonly (readonly [string, string])[]>>;

const jobNames = [
	'LOG_CLEANUP_JOB_NAME',
	'INVITATION_CLEANUP_JOB_NAME',
	'AUTOMATION_JOB_NAME',
	'STORY_REFRESH_JOB_NAME',
	'STORY_DELIVERY_JOB_NAME',
	'MANAGED_CREDIT_LIFECYCLE_JOB_NAME',
	'STRIPE_WEBHOOK_PROCESS_JOB_NAME',
	'BILLING_LIFECYCLE_JOB_NAME',
	'CLOUD_TRIAL_PROVISIONING_JOB_NAME',
	'CLOUD_WELCOME_EMAIL_JOB_NAME',
	'MCP_QUERY_DATA_CLEANUP_JOB_NAME',
	'STORY_BLOB_CLEANUP_JOB_NAME',
	'CONTEXT_BRANCH_CLEANUP_JOB_NAME',
	'CONTEXT_RECOMMENDATIONS_JOB_NAME',
] as const;

const ownerGatedJobResolvers = {
	AUTOMATION_JOB_NAME: 'resolveAutomationProjectPrincipal',
	STORY_REFRESH_JOB_NAME: 'resolveStoryRefreshProjectPrincipal',
	STORY_DELIVERY_JOB_NAME: 'resolveStoryDeliveryProjectPrincipal',
	CONTEXT_RECOMMENDATIONS_JOB_NAME: 'resolveContextRecommendationsProjectPrincipal',
} as const satisfies Partial<Record<(typeof jobNames)[number], string>>;

const messagingProviders = ['slack', 'teams', 'telegram', 'mattermost', 'discord', 'whatsapp'] as const;

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
] as const satisfies readonly (readonly [string, string, TrpcExecutionPolicy])[];

describe('cloud billing execution gate inventory', () => {
	it('classifies every registered raw route module', () => {
		const appSource = source('../src/app.ts');
		const registeredRouteModules = [...appSource.matchAll(/\bapp\.register\(\s*([A-Za-z]\w*Routes)\b/g)].map(
			(match) => match[1],
		);

		expect([...new Set(registeredRouteModules)].sort()).toEqual([...rawRouteModules].sort());
	});

	it('keeps cost-producing raw routes behind their billing gates', () => {
		for (const evidence of Object.values(rawRouteGateEvidence).flat()) {
			const [file, gate] = evidence;
			expect(source(file), `${file} must call ${gate}`).toContain(`${gate}(`);
		}
	});

	it('classifies every registered scheduler job', () => {
		const appSource = source('../src/app.ts');
		const registeredJobs = [...appSource.matchAll(/\bregisterJob\(\s*([A-Z][A-Z0-9_]*JOB_NAME)\b/g)].map(
			(match) => match[1],
		);

		expect([...new Set(registeredJobs)].sort()).toEqual([...jobNames].sort());
	});

	it('keeps owner-attributed jobs behind the owner billing gate', () => {
		const appSource = source('../src/app.ts');
		const ownerGatedJobs = jobNames.filter((jobName) =>
			jobRegistration(appSource, jobName).includes('resolveProjectPrincipal:'),
		);

		expect(ownerGatedJobs.sort()).toEqual(Object.keys(ownerGatedJobResolvers).sort());
		for (const [jobName, resolver] of Object.entries(ownerGatedJobResolvers)) {
			expect(jobRegistration(appSource, jobName)).toContain(`resolveProjectPrincipal: ${resolver}`);
		}
	});

	it('classifies every messaging integration', () => {
		const appSource = source('../src/app.ts');
		for (const provider of messagingProviders) {
			expect(appSource).toContain(`app.register(${provider}Routes`);
			expect(source(`../src/services/${provider}.ts`)).toContain('assertMessagingUserCloudBillingAccess(');
		}
	});

	it('keeps cost-producing tRPC procedures behind their declared policy', () => {
		for (const [file, procedure, policy] of costProducingTrpcPolicies) {
			const fileSource = source(`../src/trpc/${file}`);
			const declaration = procedureDeclaration(fileSource, procedure);

			if (policy === 'cached_read') {
				expect(declaration, `${file}:${procedure} must use cached data for read-only users`).toContain(
					'cachedOnly: await isProjectUserReadOnly(',
				);
			} else {
				expect(
					hasActorBillingGate(fileSource, declaration),
					`${file}:${procedure} must use an actor billing gate`,
				).toBe(true);
			}
		}
	});
});

function source(relativePath: string): string {
	return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function jobRegistration(appSource: string, jobName: string): string {
	const start = appSource.search(new RegExp(`\\bregisterJob\\(\\s*${jobName}\\b`));
	expect(start, `${jobName} must be registered`).toBeGreaterThanOrEqual(0);
	const next = appSource.indexOf('registerJob(', start + 1);
	return appSource.slice(start, next === -1 ? appSource.length : next);
}

function procedureDeclaration(fileSource: string, procedure: string): string {
	const start = fileSource.search(new RegExp(`^\\t${procedure}\\s*:`, 'm'));
	expect(start, `${procedure} must be declared`).toBeGreaterThanOrEqual(0);
	const remainder = fileSource.slice(start + 1);
	const next = remainder.search(/^\t[A-Za-z]\w*\s*:/m);
	return fileSource.slice(start, next === -1 ? fileSource.length : start + 1 + next);
}

function hasActorBillingGate(fileSource: string, declaration: string): boolean {
	if (/assert(?:Project)?UserCloudBillingAccess|assertProjectSetupCloudBillingAccess/.test(declaration)) {
		return true;
	}
	const procedure = declaration.match(/^\t[A-Za-z]\w*\s*:\s*([A-Za-z]\w*)/)?.[1];
	if (!procedure) {
		return false;
	}
	if (procedure.includes('cloudBilling')) {
		return true;
	}
	const definitionStart = fileSource.search(new RegExp(`\\bconst\\s+${procedure}\\s*=`));
	if (definitionStart === -1) {
		return false;
	}
	const definitionRemainder = fileSource.slice(definitionStart + 1);
	const definitionEnd = definitionRemainder.search(/^(?:const|export)\s/m);
	const definition = fileSource.slice(
		definitionStart,
		definitionEnd === -1 ? fileSource.length : definitionStart + 1 + definitionEnd,
	);
	return /cloudBilling|assert(?:Project)?UserCloudBillingAccess|assertProjectSetupCloudBillingAccess/.test(
		definition,
	);
}
