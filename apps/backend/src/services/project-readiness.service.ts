import fs from 'node:fs';
import path from 'node:path';

import type { DBProject } from '../db/abstractSchema';
import { extractConfiguredDatabases, extractRequiredEnvVars } from '../utils/nao-config';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

export type ProjectReadiness = {
	ready: boolean;
	hasPath: boolean;
	directoryExists: boolean;
	naoConfigExists: boolean;
	requiredEnvVars: string[];
	setEnvVarNames: string[];
	missingEnvVars: string[];
};

export async function isProjectSetupComplete(project: Pick<DBProject, 'id' | 'path'>): Promise<boolean> {
	if (!project.path) {
		return false;
	}
	const envVars = await getProjectRuntimeEnvVars(project.id);
	return (
		assessProjectReadiness({ path: project.path, envVars }).ready &&
		extractConfiguredDatabases(project.path).length > 0
	);
}

export function assessProjectReadiness(project: Pick<DBProject, 'path' | 'envVars'>): ProjectReadiness {
	const hasPath = isSet(project.path);
	const directoryExists = hasPath && isDirectory(project.path!);
	const naoConfigExists = directoryExists && isReadableFile(path.join(project.path!, 'nao_config.yaml'));
	const requiredEnvVars = directoryExists ? extractRequiredEnvVars(project.path!) : [];
	const setEnvVarNames = Object.keys(project.envVars)
		.filter((name) => isSet(project.envVars[name]))
		.sort();
	const missingEnvVars = requiredEnvVars.filter((name) => !isSet(project.envVars[name]));
	return {
		ready: naoConfigExists && missingEnvVars.length === 0,
		hasPath,
		directoryExists,
		naoConfigExists,
		requiredEnvVars,
		setEnvVarNames,
		missingEnvVars,
	};
}

function isDirectory(directoryPath: string): boolean {
	try {
		return fs.statSync(directoryPath).isDirectory();
	} catch {
		return false;
	}
}

function isReadableFile(filePath: string): boolean {
	try {
		if (!fs.statSync(filePath).isFile()) {
			return false;
		}
		fs.readFileSync(filePath);
		return true;
	} catch {
		return false;
	}
}

function isSet(value: string | null | undefined): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
