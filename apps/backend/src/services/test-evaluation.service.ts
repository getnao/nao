import type { LlmSelectedModel } from '@nao/shared/types';

import { executeQuery } from '../agents/tools/execute-sql';
import { getAgentSettings, getUserRoleInProject, retrieveProjectById } from '../queries/project.queries';
import type { TestAssertion, TestComparisonTolerances, TestVerdict } from '../types/test-run';
import type { ToolContext } from '../types/tools';
import { evaluateTestVerdict, type TestVerification } from '../utils/test-verdict';
import type { AgentRunResult } from './agent';
import { hasFeature, LICENSE_FEATURES } from './license.service';
import { getAzureAccessTokenForUser } from './microsoft-auth.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';
import { resolveSemanticLayerMode } from './semantic-layer.service';
import { TestAgentService, testAgentService, type ToolCallResult, type VerificationResult } from './test-agent.service';
import { resolveProjectContextAccess } from './user-group-context-access.service';

interface TestAttemptInput {
	prompt: string;
	sql?: string | null;
	databaseId?: string | null;
	assertions: TestAssertion[];
	tolerances?: TestComparisonTolerances;
}

export interface TestAttemptEvaluation {
	toolCalls: ToolCallResult[];
	verification: (TestVerification & Pick<VerificationResult, 'sql' | 'sourceQueries'>) | undefined;
	verdict: TestVerdict;
}

/** Checks an agent run against its test: tool call assertions, then the data against the reference SQL. */
export async function evaluateTestAttempt(input: {
	projectId: string;
	userId: string;
	test: TestAttemptInput;
	result: AgentRunResult;
	modelSelection?: LlmSelectedModel;
}): Promise<TestAttemptEvaluation> {
	const { projectId, userId, test, result, modelSelection } = input;
	const toolCalls = TestAgentService.extractToolCalls(result);

	let verification: TestAttemptEvaluation['verification'];
	if (test.sql) {
		const { data: expectedData, columns: expectedColumns } = await runReferenceQuery(
			projectId,
			userId,
			test.sql,
			test.databaseId ?? undefined,
		);
		const verified = await testAgentService.runVerification(
			projectId,
			userId,
			test.prompt,
			result,
			expectedColumns,
			modelSelection,
		);
		verification = { ...verified, expectedData, expectedColumns };
	}

	const verdict = evaluateTestVerdict({
		assertions: test.assertions,
		toolCalls,
		hasReferenceSql: Boolean(test.sql),
		verification: verification ?? null,
		tolerances: test.tolerances,
	});
	return { toolCalls, verification, verdict };
}

async function runReferenceQuery(projectId: string, userId: string, sql: string, databaseId: string | undefined) {
	const toolContext = await buildVerificationToolContext(projectId, userId);
	return executeQuery({ sql_query: sql, database_id: databaseId }, toolContext);
}

async function buildVerificationToolContext(projectId: string, userId: string): Promise<ToolContext> {
	const project = await retrieveProjectById(projectId);
	const projectFolder = project.path;
	if (!projectFolder) {
		throw new Error('Project path does not exist.');
	}
	const [envVars, azureAccessToken, contextAccess, semanticLayerMode] = await Promise.all([
		getProjectRuntimeEnvVars(projectId),
		hasFeature(LICENSE_FEATURES.sso).then((has) => (has ? getAzureAccessTokenForUser(userId) : null)),
		resolveProjectContextAccess(projectId, userId, projectFolder),
		resolveReferenceSemanticLayerMode(projectId, userId, projectFolder),
	]);
	return {
		projectFolder,
		chatId: '',
		userId,
		projectId,
		supportsCustomCharts: false,
		agentSettings: null,
		semanticLayerMode,
		adminMode: false,
		envVars,
		azureAccessToken,
		warehouseTableAccess: contextAccess.warehouseTableAccess,
		warehouseRowSecurity: contextAccess.warehouseRowSecurity,
		docsContextAccess: contextAccess.docsContextAccess,
		filesContextAccess: contextAccess.filesContextAccess,
		mcpAccess: contextAccess.mcpAccess,
		skillsAccess: contextAccess.skillsAccess,
		userGroupFeatures: contextAccess.userGroupFeatures,
		userRulesGroupAccess: contextAccess.userRulesGroupAccess,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}

/**
 * Admins and context admins write the reference SQL of tests, including the SQL compiled from semantic queries, so it
 * reaches the warehouse for them even when the project only allows the semantic layer.
 */
async function resolveReferenceSemanticLayerMode(projectId: string, userId: string, projectFolder: string) {
	const role = await getUserRoleInProject(projectId, userId);
	if (role === 'admin' || role === 'context_admin') {
		return null;
	}
	return resolveSemanticLayerMode(projectFolder, await getAgentSettings(projectId));
}
