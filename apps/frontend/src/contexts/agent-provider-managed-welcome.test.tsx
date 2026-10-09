// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentProvider, useAgentContext } from './agent.provider';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';

const mocks = vi.hoisted(() => ({
	confirmBeforeSend: vi.fn(),
	navigate: vi.fn(),
	queueOrSendMessage: vi.fn(),
	useAgent: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
}));

vi.mock('@/components/managed-welcome-grant-dialog', () => ({
	useManagedWelcomeGrant: () => ({ confirmBeforeSend: mocks.confirmBeforeSend }),
}));

vi.mock('@/hooks/use-agent', () => ({
	useAgent: mocks.useAgent,
	useSyncMessages: vi.fn(),
}));

vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
	useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/hooks/use-stream-end-sound', () => ({
	useStreamEndSound: vi.fn(),
}));

function SendHarness() {
	const { queueOrSendMessage } = useAgentContext();
	return (
		<button
			onClick={() =>
				void queueOrSendMessage({
					text: 'Keep this question',
					images: [{ data: 'data:image/png;base64,image', mediaType: 'image/png' }],
					documents: [],
				})
			}
		>
			Send
		</button>
	);
}

describe('AgentProvider managed welcome confirmation', () => {
	beforeEach(() => {
		mocks.confirmBeforeSend.mockResolvedValue('switch-project');
		mocks.useAgent.mockReturnValue({
			chatId: undefined,
			messages: [],
			setMessages: vi.fn(),
			queueOrSendMessage: mocks.queueOrSendMessage,
			editMessage: vi.fn(),
			resendMessage: vi.fn(),
			switchMessageVersion: vi.fn(),
			submitQueuedMessageNow: vi.fn(),
			status: 'ready',
			isRunning: false,
			isLoadingMessages: false,
			cancelAgent: vi.fn(),
			error: undefined,
			clearError: vi.fn(),
			selectedModel: { provider: 'nao', modelId: 'gpt-5.6-luna' },
			setSelectedModel: vi.fn(),
			setMentions: vi.fn(),
			adminMode: false,
			setAdminMode: vi.fn(),
		});
	});

	afterEach(() => {
		cleanup();
		chatInputRestoreStore.clear();
		vi.clearAllMocks();
	});

	it('preserves the draft and opens project selection without sending', async () => {
		render(
			<AgentProvider>
				<SendHarness />
			</AgentProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));

		await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' }));
		expect(mocks.queueOrSendMessage).not.toHaveBeenCalled();
		expect(chatInputRestoreStore.getSnapshot()).toEqual({
			text: 'Keep this question',
			images: [{ url: 'data:image/png;base64,image', mediaType: 'image/png' }],
			documents: [],
		});
	});
});
