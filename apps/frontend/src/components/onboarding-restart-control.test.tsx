// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnboardingProgress } from './onboarding-progress';

const mocks = vi.hoisted(() => ({
	isRunning: false,
	restart: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({ isRunning: mocks.isRunning }),
	useAgentMessages: () => [],
}));

vi.mock('@/contexts/onboarding-restart', () => ({
	useRestartOnboarding: () => ({ restart: mocks.restart, isPending: false, error: null }),
}));

afterEach(() => {
	cleanup();
	mocks.isRunning = false;
	vi.clearAllMocks();
});

describe('OnboardingProgress restart', () => {
	it('restarts the onboarding after an inline confirmation', async () => {
		render(<OnboardingProgress canRestart={true} />);

		fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
		expect(screen.getByText('Cancel the current setup and start over?')).toBeTruthy();
		expect(mocks.restart).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
		await waitFor(() => expect(mocks.restart).toHaveBeenCalledOnce());
	});

	it('keeps going when the user changes their mind', () => {
		render(<OnboardingProgress canRestart={true} />);

		fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
		fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));

		expect(screen.queryByText('Cancel the current setup and start over?')).toBeNull();
		expect(mocks.restart).not.toHaveBeenCalled();
	});

	it('waits for the agent to finish replying before offering a restart', () => {
		mocks.isRunning = true;
		render(<OnboardingProgress canRestart={true} />);

		expect((screen.getByRole('button', { name: 'Start over' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('hides the restart once onboarding cannot be restarted', () => {
		render(<OnboardingProgress />);

		expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
	});
});
