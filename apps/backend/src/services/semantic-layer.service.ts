import type { executeSemanticQuery } from '@nao/shared/tools';
import { DEFAULT_SEMANTIC_LAYER_MODE, type SemanticLayerMode } from '@nao/shared/types';

import { env } from '../env';
import type { AgentSettings } from '../types/agent-settings';
import type { ToolContext } from '../types/tools';
import { extractConfiguredSemanticLayer } from '../utils/nao-config';

/** A metric query in semantic terms, mirroring the `/semantic_layer/compile` request body. */
export type SemanticQuery = executeSemanticQuery.SemanticQuery;

/** The semantic layer rejected the query (for example an unknown metric or dimension); its message is safe to show to the caller. */
export class SemanticQueryCompileError extends Error {}

export type CompiledSemanticQuery = {
	sql: string;
	database_id: string;
	dialect: string;
};

type SemanticLayerContext = Pick<ToolContext, 'projectFolder' | 'envVars'>;

/**
 * The semantic layer routing mode in effect for a run, or null when the project
 * declares no `semantic_layer` in nao_config.yaml. The repo decides whether a layer
 * exists; the admin settings decide how the agent uses it.
 */
export function resolveSemanticLayerMode(
	projectFolder: string,
	agentSettings: AgentSettings | null,
): SemanticLayerMode | null {
	if (!extractConfiguredSemanticLayer(projectFolder)) {
		return null;
	}
	return agentSettings?.semanticLayer?.mode ?? DEFAULT_SEMANTIC_LAYER_MODE;
}

/** `execute_semantic_query` is only exposed when the layer exists and the admin lets the agent query it. */
export function isSemanticQueryToolEnabled(mode: SemanticLayerMode | null | undefined): boolean {
	return mode === 'prioritized' || mode === 'exclusive';
}

/**
 * In semantics-only mode the warehouse is only reachable through the layer: `execute_sql` stays
 * available but is restricted to nao's local DuckDB (files and earlier results).
 */
export function isWarehouseSqlEnabled(mode: SemanticLayerMode | null | undefined): boolean {
	return mode !== 'exclusive';
}

/** Compiles metrics and dimensions to SQL with the project's semantic layer; execution stays with execute_sql. */
export async function compileSemanticQuery(
	query: SemanticQuery,
	context: SemanticLayerContext,
): Promise<CompiledSemanticQuery> {
	const response = await postToSemanticLayer('compile', query, context);
	if (!response.ok) {
		const message = `Error compiling semantic query: ${await readErrorDetail(response)}`;
		throw response.status === 422 ? new SemanticQueryCompileError(message) : new Error(message);
	}
	return (await response.json()) as CompiledSemanticQuery;
}

/** Lists the metrics and dimensions the project's semantic layer exposes. */
export async function describeSemanticLayer(context: SemanticLayerContext): Promise<executeSemanticQuery.Catalog> {
	const response = await postToSemanticLayer('catalog', {}, context);
	if (!response.ok) {
		throw new Error(`Error describing the semantic layer: ${await readErrorDetail(response)}`);
	}
	return (await response.json()) as executeSemanticQuery.Catalog;
}

function postToSemanticLayer(
	endpoint: 'compile' | 'catalog',
	body: object,
	context: SemanticLayerContext,
): Promise<Response> {
	return fetch(`http://localhost:${env.FASTAPI_PORT}/semantic_layer/${endpoint}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Nao-Internal-Secret': env.BETTER_AUTH_SECRET,
		},
		body: JSON.stringify({
			...body,
			nao_project_folder: context.projectFolder,
			...(Object.keys(context.envVars).length > 0 && { env_vars: context.envVars }),
		}),
	});
}

async function readErrorDetail(response: Response): Promise<string> {
	const errorData = await response.json().catch(() => ({ detail: response.statusText }));
	return typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
}
