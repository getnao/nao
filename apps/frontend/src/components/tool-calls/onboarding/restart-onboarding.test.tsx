// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestartOnboardingToolCall } from './restart-onboarding';
import type { ToolCallComponentProps } from '..';

const mocks = vi.hoisted(() => ({
	isRunning: false,
	startNewOnboarding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({ isRunning: mocks.isRunning }),
}));

vi.mock('@/contexts/onboarding/onboarding-restart', () => ({
	useStartNewOnboarding: () => mocks.startNewOnboarding,
}));

afterEach(() => {
	cleanup();
	mocks.isRunning = false;
	vi.clearAllMocks();
});

describe('RestartOnboardingToolCall', () => {
	it('moves to a new conversation once the restart finishes during the turn', () => {
		mocks.isRunning = true;
		const view = render(<RestartOnboardingToolCall toolPart={createToolPart('input-available')} />);

		view.rerender(<RestartOnboardingToolCall toolPart={createToolPart('output-available')} />);
		expect(mocks.startNewOnboarding).not.toHaveBeenCalled();

		mocks.isRunning = false;
		view.rerender(<RestartOnboardingToolCall toolPart={createToolPart('output-available')} />);
		expect(mocks.startNewOnboarding).toHaveBeenCalledOnce();
	});

	it('only shows the restart when reopening the previous conversation', () => {
		render(<RestartOnboardingToolCall toolPart={createToolPart('output-available')} />);

		expect(screen.getByText('Onboarding restarted in a new conversation')).toBeTruthy();
		expect(mocks.startNewOnboarding).not.toHaveBeenCalled();
	});
});

function createToolPart(state: 'input-available' | 'output-available') {
	return {
		type: 'tool-restart_onboarding',
		toolCallId: 'tool-1',
		state,
		input: {},
		...(state === 'output-available' && { output: { cancelledWarehouseSetup: true } }),
	} as ToolCallComponentProps<'restart_onboarding'>['toolPart'];
}
