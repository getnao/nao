// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GenerateOnboardingRulesToolCall } from './generate-onboarding-rules';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
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
});
