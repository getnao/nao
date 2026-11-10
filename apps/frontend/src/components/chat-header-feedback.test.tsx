// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatHeaderFeedback } from './chat-header-feedback';
import type { UIMessage } from '@nao/backend/chat';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	agentSettings: { requireConversationFeedback: true },
	features: { 'conversation-feedback': true },
	isCloud: false,
	isRunning: false,
	mode: 'default',
	isReadonly: false,
	messages: [] as UIMessage[],
	mutate: vi.fn(),
}));

const hiddenCases: Array<
	[
		string,
		{
			setting?: boolean;
			licensed?: boolean;
			cloud?: boolean;
			messages?: UIMessage[];
		},
	]
> = [
	['the project setting is disabled', { setting: false }],
	['the license feature is unavailable', { licensed: false }],
	['the deployment is cloud-hosted', { cloud: true }],
	['there is no assistant answer', { messages: [] }],
];

vi.mock('@tanstack/react-query', () => ({
	useQuery: () => ({ data: mocks.agentSettings }),
	useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		isRunning: mocks.isRunning,
		mode: mocks.mode,
		isReadonly: mocks.isReadonly,
	}),
	useAgentMessagesSelector: (selector: (messages: UIMessage[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: mocks.features }),
}));

vi.mock('@/hooks/use-nao-mode', () => ({
	useIsCloud: () => mocks.isCloud,
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getAgentSettings: { queryOptions: () => ({}) },
			getChatReplay: { queryKey: () => ['chat-replay'] },
			getProjectChats: { queryKey: () => ['project-chats'] },
		},
		chat: {
			get: { queryKey: () => ['chat'] },
		},
		feedback: {
			submit: { mutationOptions: (options: unknown) => options },
		},
	},
}));

describe('ChatHeaderFeedback', () => {
	beforeEach(() => {
		mocks.agentSettings.requireConversationFeedback = true;
		mocks.features['conversation-feedback'] = true;
		mocks.isCloud = false;
		mocks.isRunning = false;
		mocks.mode = 'default';
		mocks.isReadonly = false;
		mocks.messages = [assistantMessage('answer-1')];
		mocks.mutate.mockReset();
	});

	afterEach(cleanup);

	it.each(hiddenCases)('hides the controls when %s', (_, state) => {
		if (state.setting === false) {
			mocks.agentSettings.requireConversationFeedback = false;
		}
		if (state.licensed === false) {
			mocks.features['conversation-feedback'] = false;
		}
		if (state.cloud === true) {
			mocks.isCloud = true;
		}
		if (state.messages) {
			mocks.messages = state.messages;
		}

		renderFeedback();

		expect(screen.queryByRole('button', { name: 'Good conversation' })).toBeNull();
	});

	it('submits feedback for the latest assistant answer', () => {
		mocks.messages = [
			assistantMessage('answer-1'),
			{ id: 'question-2', role: 'user', parts: [{ type: 'text', text: 'More detail' }] } as UIMessage,
			assistantMessage('answer-2'),
		];
		renderFeedback();

		fireEvent.click(screen.getByRole('button', { name: 'Good conversation' }));
		fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Useful answer  ' } });
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(mocks.mutate).toHaveBeenCalledWith({
			chatId: 'chat-1',
			messageId: 'answer-2',
			vote: 'up',
			explanation: 'Useful answer',
		});
	});

	it('keeps the selected vote visible and disables voting while an answer is running', () => {
		mocks.isRunning = true;
		mocks.messages = [assistantMessage('answer-1', 'down')];
		renderFeedback();

		const negativeButton = screen.getByRole('button', { name: 'Bad conversation' });
		expect(negativeButton.getAttribute('aria-pressed')).toBe('true');
		expect(negativeButton.hasAttribute('disabled')).toBe(true);
	});
});

function renderFeedback() {
	return render(
		<TooltipProvider>
			<ChatHeaderFeedback chatId='chat-1' />
		</TooltipProvider>,
	);
}

function assistantMessage(id: string, vote?: 'up' | 'down'): UIMessage {
	return {
		id,
		role: 'assistant',
		parts: [{ type: 'text', text: 'Answer' }],
		feedback: vote
			? {
					messageId: id,
					vote,
					explanation: null,
					createdAt: new Date(),
					updatedAt: new Date(),
				}
			: undefined,
	} as UIMessage;
}
