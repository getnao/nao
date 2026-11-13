import { withKeyedLock } from '../utils/keyed-lock';

export function withUserGroupConfigLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
	return withKeyedLock(`user-groups:${projectId}`, operation);
}
