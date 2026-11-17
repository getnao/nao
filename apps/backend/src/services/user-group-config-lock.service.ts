import { withDatabaseKeyedLock } from '../utils/keyed-lock';

export function withUserGroupConfigLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
	return withDatabaseKeyedLock(`user-groups:${projectId}`, operation);
}
