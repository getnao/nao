import { fromExplorerTestPath } from '@nao/shared/test-paths';

import * as testRunQueries from '../queries/test-run.queries';
import * as userSkillQueries from '../queries/user-skill.queries';
import type { ShownContextHubPage } from '../types/chat';
import { logger } from '../utils/logger';

const MAX_LISTED_FAILURES = 10;

export interface TestRunOutcome {
	id: string;
	status: string;
	passedAttempts: number;
	completedAttempts: number;
	totalAttempts: number;
	failures: { testPath: string; model: string; reason: string | null }[];
}

export interface ShownSkillContent {
	name: string;
	description: string;
	body: string;
	authorName?: string;
	note?: string | null;
}

/** What the context editor is told about the page beside it, with what it cannot read itself loaded for it. */
export type DescribedContextHubPage =
	| Exclude<ShownContextHubPage, { type: 'tests' | 'test' | 'personal-skill' | 'share-request' }>
	| { type: 'tests'; run: TestRunOutcome | null }
	| { type: 'test'; path: string; run: TestRunOutcome | null }
	| { type: 'personal-skill'; name: string; skill: ShownSkillContent | null }
	| { type: 'share-request'; id: string; request: ShownSkillContent | null };

/** Never fails the run: a page that cannot be loaded is described without its content. */
export async function describeShownContextHubPage(
	shown: ShownContextHubPage,
	scope: { projectId: string; userId: string },
): Promise<DescribedContextHubPage> {
	try {
		return await describePage(shown, scope);
	} catch (error) {
		logger.warn(`Failed to describe the Context Hub page: ${String(error)}`, { source: 'agent' });
		return withoutContent(shown);
	}
}

async function describePage(
	shown: ShownContextHubPage,
	{ projectId, userId }: { projectId: string; userId: string },
): Promise<DescribedContextHubPage> {
	switch (shown.type) {
		case 'tests':
			return { type: 'tests', run: shown.runId ? await getRunOutcome(projectId, shown.runId, null) : null };
		case 'test':
			return {
				type: 'test',
				path: shown.path,
				run: shown.runId ? await getRunOutcome(projectId, shown.runId, fromExplorerTestPath(shown.path)) : null,
			};
		case 'personal-skill': {
			const skill = await userSkillQueries.getUserSkill(projectId, userId, shown.name);
			return { type: 'personal-skill', name: shown.name, skill: skill && toSkillContent(skill) };
		}
		case 'share-request': {
			const request = await userSkillQueries.getUserSkillById(projectId, shown.id);
			const isOpen = request?.shareStatus === 'requested';
			return {
				type: 'share-request',
				id: shown.id,
				request: isOpen
					? { ...toSkillContent(request), authorName: request.authorName, note: request.shareNote }
					: null,
			};
		}
		default:
			return shown;
	}
}

/** The outcome of a run, narrowed to one test when the page shows a single test. */
async function getRunOutcome(
	projectId: string,
	runId: string,
	testPath: string | null,
): Promise<TestRunOutcome | null> {
	const run = await testRunQueries.getRun(projectId, runId);
	if (!run) {
		return null;
	}
	const results = (await testRunQueries.listResultOutcomes(run.id)).filter(
		(result) => testPath === null || result.testPath === testPath,
	);
	const failures = results
		.filter((result) => !result.passed)
		.slice(0, MAX_LISTED_FAILURES)
		.map((result) => ({
			testPath: result.testPath,
			model: result.llmModelId,
			reason: result.errorMessage ?? result.message,
		}));
	return {
		id: run.id,
		status: run.status,
		passedAttempts: testPath === null ? run.passedAttempts : results.filter((result) => result.passed).length,
		completedAttempts: testPath === null ? run.completedAttempts : results.length,
		totalAttempts: testPath === null ? run.totalAttempts : results.length,
		failures,
	};
}

function toSkillContent(skill: { name: string; description: string; body: string }): ShownSkillContent {
	return { name: skill.name, description: skill.description, body: skill.body };
}

function withoutContent(shown: ShownContextHubPage): DescribedContextHubPage {
	switch (shown.type) {
		case 'tests':
			return { type: 'tests', run: null };
		case 'test':
			return { type: 'test', path: shown.path, run: null };
		case 'personal-skill':
			return { type: 'personal-skill', name: shown.name, skill: null };
		case 'share-request':
			return { type: 'share-request', id: shown.id, request: null };
		default:
			return shown;
	}
}
