import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	releaseLock: vi.fn(),
	renewLock: vi.fn(),
	tryAcquireLock: vi.fn(),
}));

vi.mock('../../src/db/dbConfig', () => ({
	default: { dialect: 'sqlite' },
	Dialect: { Postgres: 'postgres', Sqlite: 'sqlite' },
}));

vi.mock('../../src/queries/keyed-lock.queries', () => mocks);

import { withUserGroupConfigLock } from '../../src/services/user-group-config-lock.service';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.tryAcquireLock.mockResolvedValue(true);
	mocks.releaseLock.mockResolvedValue(undefined);
});

it('uses the database lock for SQLite', async () => {
	await expect(withUserGroupConfigLock('project-id', async () => 'result')).resolves.toBe('result');

	expect(mocks.tryAcquireLock).toHaveBeenCalledWith('user-groups:project-id', expect.any(String), 120_000);
	expect(mocks.releaseLock).toHaveBeenCalledWith('user-groups:project-id', expect.any(String));
});
