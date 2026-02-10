import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Get or create a persistent anonymous distinct ID for this user.
 * The ID is stored in ~/.nao/distinct_id to persist across invocations.
 */
export const getPostHogDistinctId = (): string => {
	try {
		const existingId = getPostHogIdFromFile();
		if (existingId) {
			return existingId;
		}

		// Create new ID and persist it
		const newId = randomUUID();
		persistPostHogId(newId);
		return newId;
	} catch {
		// If we can't persist, generate a new ID each time
		return randomUUID();
	}
};

const getPostHogIdFromFile = () => {
	const filePath = getDistinctIdFilePath();
	if (!existsSync(filePath)) {
		return undefined;
	}
	const existingId = readFileSync(filePath, 'utf-8').trim().split('\n')[0];
	if (!isValidUuid(existingId)) {
		return undefined;
	}
	return existingId;
};

const getDistinctIdFilePath = () => join(homedir(), '.nao', 'distinct_id');

const isValidUuid = (id: string): boolean => {
	return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
};

export const persistPostHogId = (id: string) => {
	const filePath = getDistinctIdFilePath();
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, id, 'utf-8');
};
