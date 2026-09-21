import { listUserProjects } from '../queries/project.queries';

export type McpProjectResolution = { projectId: string } | { error: string };

/**
 * The project an MCP request targets: the `/mcp/:projectId` path segment when present, otherwise
 * the user's only project. Users who belong to several projects must pick one through the URL.
 */
export async function resolveMcpProjectId(
	userId: string,
	requestedProjectId: string | undefined,
	mcpBaseUrl: string,
): Promise<McpProjectResolution> {
	if (requestedProjectId) {
		return { projectId: requestedProjectId };
	}

	const projects = await listUserProjects(userId);
	if (projects.length === 0) {
		return { error: 'No projects found for this user. Create or join a project first.' };
	}
	if (projects.length === 1) {
		return { projectId: projects[0].id };
	}

	const listing = projects.map((project) => `  - ${project.name}: ${mcpBaseUrl}/${project.id}`).join('\n');
	return {
		error: `You belong to several projects, so ${mcpBaseUrl} is ambiguous. Use the project-specific endpoint instead:\n${listing}`,
	};
}
