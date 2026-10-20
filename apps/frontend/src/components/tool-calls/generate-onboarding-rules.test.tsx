// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerateOnboardingRulesToolCall } from './generate-onboarding-rules';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	isSettled: true,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({
		data: { status: 'finalizing' },
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
		},
		organization: {
			getProjects: { queryKey: () => ['projects'] },
		},
	},
}));

afterEach(() => {
	cleanup();
	mocks.isSettled = true;
	vi.clearAllMocks();
});

describe('GenerateOnboardingRulesToolCall', () => {
	it('refreshes the active onboarding job when finalization starts', async () => {
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
				queryKey: ['active-job', 'chat-1'],
			}),
		);
	});

	it('shows an interruption instead of a spinner when a settled call has no output', () => {
		const toolPart = {
			type: 'tool-generate_onboarding_rules',
			toolCallId: 'tool-1',
			state: 'input-available',
			input: { jobId: 'job-1', businessContext: {} },
		} as ToolCallComponentProps<'generate_onboarding_rules'>['toolPart'];

		const view = render(<GenerateOnboardingRulesToolCall toolPart={toolPart} />);

		expect(view.queryByText('Finalizing your connection')).toBeNull();
		expect(view.getByText('Connection finalization failed')).toBeTruthy();
		expect(view.getByText('Connection finalization was interrupted. Please try again.')).toBeTruthy();
	});
});
