import * as projectQueries from '../queries/project.queries';
import { getProjectWarehouseEnvVars } from './warehouse-credentials';

export async function getProjectRuntimeEnvVars(projectId: string): Promise<Record<string, string>> {
	const [projectEnvVars, warehouseEnvVars] = await Promise.all([
		projectQueries.getEnvVars(projectId),
		getProjectWarehouseEnvVars(projectId),
	]);

	return {
		...projectEnvVars,
		...warehouseEnvVars,
	};
}
