import {
	type DbtChartsRender,
	DbtChartsRenderSchema,
	type DbtChartsValidation,
	DbtChartsValidationSchema,
	type DbtChartsVariables,
} from '@nao/shared/dbt-charts';

import * as projectQueries from '../queries/project.queries';
import { fastapiUrl, internalHeaders, readJsonOrThrow } from './dbt-charts-status';
import { resolveExcludedColumnEnforcementForProject } from './excluded-columns.service';

export { getDbtChartsStatus, isDbtChartsAvailable } from './dbt-charts-status';

export const DBT_CHARTS_FONTS_ROUTE = '/api/dbt-charts/fonts';

export interface RenderBoardOptions {
	variables?: DbtChartsVariables;
	databaseId?: string;
	azureAccessToken?: string;
}

export async function validateBoard(
	projectId: string,
	boardYaml: string,
	databaseId?: string,
): Promise<DbtChartsValidation> {
	const { projectFolder, envVars } = await loadProjectContext(projectId);
	const response = await fetch(fastapiUrl('/dbt_charts/validate'), {
		method: 'POST',
		headers: internalHeaders(),
		body: JSON.stringify({
			yaml: boardYaml,
			nao_project_folder: projectFolder,
			...(databaseId && { database_id: databaseId }),
			...(Object.keys(envVars).length > 0 && { env_vars: envVars }),
		}),
	});
	return DbtChartsValidationSchema.parse(await readJsonOrThrow(response));
}

export async function renderBoard(
	projectId: string,
	boardYaml: string,
	options: RenderBoardOptions = {},
): Promise<DbtChartsRender> {
	const { projectFolder, envVars } = await loadProjectContext(projectId);
	const enforceExcludedColumns = await resolveExcludedColumnEnforcementForProject(projectId);
	const response = await fetch(fastapiUrl('/dbt_charts/render'), {
		method: 'POST',
		headers: internalHeaders(),
		body: JSON.stringify({
			yaml: boardYaml,
			nao_project_folder: projectFolder,
			variables: options.variables ?? {},
			enforce_excluded_columns: enforceExcludedColumns,
			font_url_prefix: DBT_CHARTS_FONTS_ROUTE,
			...(options.databaseId && { database_id: options.databaseId }),
			...(options.azureAccessToken && { azure_access_token: options.azureAccessToken }),
			...(Object.keys(envVars).length > 0 && { env_vars: envVars }),
		}),
	});
	return DbtChartsRenderSchema.parse(await readJsonOrThrow(response));
}

export async function fetchFont(fileName: string): Promise<Response> {
	return fetch(fastapiUrl(`/dbt_charts/fonts/${encodeURIComponent(fileName)}`), { headers: internalHeaders() });
}

async function loadProjectContext(
	projectId: string,
): Promise<{ projectFolder: string; envVars: Record<string, string> }> {
	const project = await projectQueries.retrieveProjectById(projectId);
	if (!project.path) {
		throw new Error('Project path not configured');
	}
	const envVars = await projectQueries.getEnvVars(projectId);
	return { projectFolder: project.path, envVars };
}
