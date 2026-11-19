// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { UserGroupCodeManagement } from '@/components/settings/user-group-code-management';

const mocks = vi.hoisted(() => ({
	managementStatus: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: mocks.managementStatus() }),
}));

vi.mock('@/main', () => ({
	trpcClient: { userGroup: { exportConfig: { query: vi.fn() } } },
	trpc: { userGroup: { managementStatus: { queryOptions: () => ({ queryKey: ['management-status'] }) } } },
}));

const LAST_SUCCESS = { completedAt: '2026-11-13T13:47:53.000Z', actorName: null, actorEmail: null };

beforeEach(() => {
	mocks.managementStatus.mockReset();
});

afterEach(cleanup);

it.each([
	['shows a failure newer than the last sync', '2026-11-13T14:00:00.000Z', true],
	['hides a failure superseded by a later sync', '2026-11-13T13:43:17.000Z', false],
])('%s', (_label, failedAt, isShown) => {
	mocks.managementStatus.mockReturnValue({
		mode: 'code',
		configPath: 'groups.yaml',
		pendingEmails: [],
		lastSuccess: LAST_SUCCESS,
		latestFailure: { completedAt: failedAt, errorMessage: 'groups.yaml is missing.' },
	});

	render(<UserGroupCodeManagement />);

	expect(screen.getByText(/Last synced.*nao at startup/)).toBeTruthy();
	expect(screen.queryByText(/Last attempt failed.*groups.yaml is missing/) !== null).toBe(isShown);
});
