import { and, eq, inArray } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export const getProjectMcpToolSettings = async (projectId: string, serverName: string) => {
	return db
		.select()
		.from(s.projectMcpToolSetting)
		.where(
			and(eq(s.projectMcpToolSetting.projectId, projectId), eq(s.projectMcpToolSetting.serverName, serverName)),
		)
		.execute();
};

export const resolveProjectMcpToolEnabledStates = async (
	projectId: string,
	serverName: string,
	toolNames: string[],
): Promise<Record<string, boolean>> => {
	if (toolNames.length === 0) {
		return {};
	}

	const existingRows = await getProjectMcpToolSettings(projectId, serverName);

	// First-seen server tools default enabled to preserve backward compatibility.
	if (existingRows.length === 0) {
		await db
			.insert(s.projectMcpToolSetting)
			.values(
				toolNames.map((toolName) => ({
					projectId,
					serverName,
					toolName,
					enabled: true,
				})),
			)
			.onConflictDoNothing()
			.execute();

		return Object.fromEntries(toolNames.map((toolName) => [toolName, true]));
	}

	const enabledByTool = new Map(existingRows.map((row) => [row.toolName, row.enabled]));
	return Object.fromEntries(toolNames.map((toolName) => [toolName, enabledByTool.get(toolName) ?? false]));
};

export const setProjectMcpToolEnabledState = async (params: {
	projectId: string;
	serverName: string;
	toolName: string;
	enabled: boolean;
}) => {
	await db
		.insert(s.projectMcpToolSetting)
		.values({
			projectId: params.projectId,
			serverName: params.serverName,
			toolName: params.toolName,
			enabled: params.enabled,
		})
		.onConflictDoUpdate({
			target: [
				s.projectMcpToolSetting.projectId,
				s.projectMcpToolSetting.serverName,
				s.projectMcpToolSetting.toolName,
			],
			set: {
				enabled: params.enabled,
				updatedAt: new Date(),
			},
		})
		.execute();
};

export const setAllProjectMcpToolsEnabledState = async (params: {
	projectId: string;
	serverName: string;
	toolNames: string[];
	enabled: boolean;
}) => {
	if (params.toolNames.length === 0) {
		return;
	}

	await db
		.insert(s.projectMcpToolSetting)
		.values(
			params.toolNames.map((toolName) => ({
				projectId: params.projectId,
				serverName: params.serverName,
				toolName,
				enabled: params.enabled,
			})),
		)
		.onConflictDoUpdate({
			target: [
				s.projectMcpToolSetting.projectId,
				s.projectMcpToolSetting.serverName,
				s.projectMcpToolSetting.toolName,
			],
			set: {
				enabled: params.enabled,
				updatedAt: new Date(),
			},
		})
		.execute();
};

export const isProjectMcpToolEnabled = async (params: {
	projectId: string;
	serverName: string;
	toolName: string;
}): Promise<boolean> => {
	const [setting] = await db
		.select()
		.from(s.projectMcpToolSetting)
		.where(
			and(
				eq(s.projectMcpToolSetting.projectId, params.projectId),
				eq(s.projectMcpToolSetting.serverName, params.serverName),
				eq(s.projectMcpToolSetting.toolName, params.toolName),
			),
		)
		.execute();

	return setting?.enabled ?? true;
};

export const getProjectMcpToolSettingsForServerTools = async (params: {
	projectId: string;
	serverName: string;
	toolNames: string[];
}) => {
	if (params.toolNames.length === 0) {
		return [];
	}

	return db
		.select()
		.from(s.projectMcpToolSetting)
		.where(
			and(
				eq(s.projectMcpToolSetting.projectId, params.projectId),
				eq(s.projectMcpToolSetting.serverName, params.serverName),
				inArray(s.projectMcpToolSetting.toolName, params.toolNames),
			),
		)
		.execute();
};
