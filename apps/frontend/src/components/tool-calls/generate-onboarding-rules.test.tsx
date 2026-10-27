// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerateOnboardingRulesToolCall } from './generate-onboarding-rules';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	isSettled: true,
	jobData: { status: 'finalizing' } as { status: string; projectId?: string },
	setActiveProjectId: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: mocks.jobData,
		isError: false,
	}),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		chatId: 'chat-1',
		isRunning: false,
	}),
}));

vi.mock('@/contexts/tool-call', () => ({
	useToolCallContext: () => ({ isSettled: mocks.isSettled }),
}));

vi.mock('@/lib/active-project', () => ({
	setActiveProjectId: mocks.setActiveProjectId,
}));

vi.mock('@/main', () => ({
	trpc: {
		onboarding: {
			getActiveWarehouseProvisioningJob: {
				queryKey: ({ onboardingChatId }: { onboardingChatId: string }) => ['active-job', onboardingChatId],
			},
			getWarehouseProvisioningStatus: {
				queryOptions: () => ({}),
			},
		},
		project: {
			getCurrent: { queryKey: () => ['current-project'] },
			isCurrentSetupComplete: { queryKey: () => ['setup-complete'] },
		},
		organization: {
			getProjects: { queryKey: () => ['projects'] },
		},
	},
}));

afterEach(() => {
	cleanup();
	mocks.isSettled = true;
	mocks.jobData = { status: 'finalizing' };
	vi.clearAllMocks();
});

describe('GenerateOnboardingRulesToolCall', () => {
	it('refreshes the active onboarding job when finalization starts', async () => {
		const toolPart = {
			type: 'tool-generate_onboarding_rules',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { businessContext: {} },
			output: { jobId: 'job-1', status: 'finalizing' },
		} as ToolCallComponentProps<'generate_onboarding_rules'>['toolPart'];

		const view = render(<GenerateOnboardingRulesToolCall toolPart={toolPart} />);
		expect(view.container.textContent).toBe('');

		await waitFor(() =>
			expect(mocks.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['active-job', 'chat-1'],
			}),
		);
	});

	it('refreshes project setup completion when warehouse setup becomes ready', async () => {
		mocks.jobData = { status: 'ready', projectId: 'project-1' };
		const toolPart = {
			type: 'tool-generate_onboarding_rules',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { jobId: 'job-1', businessContext: {} },
			output: { jobId: 'job-1', status: 'finalizing' },
		} as ToolCallComponentProps<'generate_onboarding_rules'>['toolPart'];

		render(<GenerateOnboardingRulesToolCall toolPart={toolPart} />);

		await waitFor(() =>
			expect(mocks.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ['setup-complete'],
			}),
		);
	});

	it('shows an interruption instead of a spinner when a settled call has no output', () => {
		const toolPart = {
			type: 'tool-generate_onboarding_rules',
			toolCallId: 'tool-1',
			state: 'input-available',
			input: { businessContext: {} },
		} as ToolCallComponentProps<'generate_onboarding_rules'>['toolPart'];

		const view = render(<GenerateOnboardingRulesToolCall toolPart={toolPart} />);

		expect(view.getByRole('alert').textContent).toContain('Project setup stopped');
		expect(view.getByText('Connection finalization was interrupted. Please try again.')).toBeTruthy();
	});
});
