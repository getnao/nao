// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalAgentOverview, LocalAgentStatus } from '@nao/shared/local-agent';

import { ClaudeCodeConnectionSettings } from '@/components/settings/claude-code-connection';

const mocks = vi.hoisted(() => ({
	isDesktopApp: true,
	status: undefined as LocalAgentStatus | undefined,
	overview: undefined as LocalAgentOverview | undefined,
}));

vi.mock('@/lib/local-agent', () => ({ isDesktopApp: () => mocks.isDesktopApp }));
vi.mock('@/hooks/use-local-agent-status', () => ({
	useLocalAgentStatus: () => ({ status: mocks.status, isPending: false, refresh: vi.fn() }),
}));
vi.mock('@/hooks/use-local-agent-overview', () => ({
	useLocalAgentOverview: () => ({ data: mocks.overview, isPending: false, isError: false, error: null }),
}));

const READY: LocalAgentStatus = {
	state: 'ready',
	version: '2.1.317',
	account: { email: 'ada@example.com', subscriptionType: 'max' },
	models: [],
};

const EMPTY_USAGE: LocalAgentOverview['usage'] = {
	periodDays: 30,
	totals: { turns: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
	byModel: [],
	byDay: [],
	recentTurns: [],
};

afterEach(() => {
	cleanup();
	mocks.isDesktopApp = true;
	mocks.status = undefined;
	mocks.overview = undefined;
});

describe('ClaudeCodeConnectionSettings', () => {
	it('shows the signed-in account, a meter per plan window and what nao used', () => {
		mocks.status = READY;
		mocks.overview = {
			rateLimits: {
				state: 'available',
				windows: [
					{ label: 'Current week (all models)', utilization: 39, resetsAt: null },
					{ label: 'Current week (Opus)', utilization: 92, resetsAt: null },
				],
				extraUsage: null,
			},
			usage: {
				...EMPTY_USAGE,
				totals: { turns: 3, inputTokens: 128_400, outputTokens: 2_100, estimatedCostUsd: 1.5 },
				byModel: [
					{
						modelId: 'claude-sonnet-5-5',
						turns: 3,
						inputTokens: 128_400,
						outputTokens: 2_100,
						estimatedCostUsd: 1.5,
					},
				],
			},
		};

		render(<ClaudeCodeConnectionSettings />);

		expect(screen.getByText('ada@example.com')).toBeTruthy();
		expect(screen.getByText('Max')).toBeTruthy();
		expect(screen.getByRole('meter', { name: 'Current week (all models)' }).getAttribute('aria-valuenow')).toBe(
			'39',
		);
		expect(screen.getByText('Almost at the limit')).toBeTruthy();
		expect(screen.getByText('128.4K')).toBeTruthy();
		expect(screen.getAllByText('$1.50')).toHaveLength(2);
	});

	it('explains how to sign in when Claude Code is signed out', () => {
		mocks.status = { state: 'not-logged-in', version: '2.1.317' };
		mocks.overview = { rateLimits: { state: 'unavailable' }, usage: EMPTY_USAGE };

		render(<ClaudeCodeConnectionSettings />);

		expect(screen.getByText('Claude Code is not signed in')).toBeTruthy();
		expect(screen.getByText(/only apply when Claude Code is signed in to a Claude plan/)).toBeTruthy();
		expect(screen.getByText(/No chat ran through your Claude Code/)).toBeTruthy();
	});

	it('points to the desktop app in a browser', () => {
		mocks.isDesktopApp = false;

		render(<ClaudeCodeConnectionSettings />);

		expect(screen.getByText(/Open nao in the desktop app/)).toBeTruthy();
		expect(screen.queryByText('Plan limits')).toBeNull();
	});
});
