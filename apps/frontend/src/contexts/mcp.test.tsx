// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { McpProvider, useMcpContext } from './mcp';
import type { McpServerStatus } from '@nao/shared';

const mocks = vi.hoisted(() => ({
	project: { data: { id: 'project-a' } as { id: string } | null },
	getServers: vi.fn(),
	getConfigError: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => mocks.project,
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['current-project'] }) },
		},
	},
	trpcClient: {
		mcp: {
			getServers: { query: mocks.getServers },
			getConfigError: { query: mocks.getConfigError },
		},
	},
}));

afterEach(() => {
	cleanup();
	mocks.project = { data: { id: 'project-a' } };
	vi.clearAllMocks();
});

it('ignores refresh results from the previous project', async () => {
	const projectAServers = deferred<McpServerStatus[]>();
	const projectAError = deferred<string | null>();
	const projectBServers = [{ name: 'project-b' }] as McpServerStatus[];

	mocks.getServers.mockReturnValueOnce(projectAServers.promise).mockResolvedValueOnce(projectBServers);
	mocks.getConfigError.mockReturnValueOnce(projectAError.promise).mockResolvedValueOnce(null);

	const { result, rerender } = renderHook(() => useMcpContext(), { wrapper: McpProvider });
	await waitFor(() => expect(mocks.getServers).toHaveBeenCalledTimes(1));

	mocks.project = { data: { id: 'project-b' } };
	rerender();
	await waitFor(() => expect(result.current.servers).toBe(projectBServers));

	await act(async () => {
		projectAServers.resolve([{ name: 'project-a' }] as McpServerStatus[]);
		projectAError.resolve('stale error');
		await Promise.all([projectAServers.promise, projectAError.promise]);
	});

	expect(result.current.servers).toBe(projectBServers);
	expect(result.current.configError).toBeNull();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
