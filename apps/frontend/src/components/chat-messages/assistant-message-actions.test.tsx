// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssistantMessageActions, FeedbackDialog } from './assistant-message-actions';
import type { UIMessage } from '@nao/backend/chat';

const { submitFeedbackMock } = vi.hoisted(() => ({ submitFeedbackMock: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		feedback: {
			submit: { mutationOptions: (options: object) => ({ ...options, mutationFn: submitFeedbackMock }) },
		},
		chat: { get: { queryKey: (input: object) => ['chat.get', input] } },
		project: {
			getChatReplay: { queryKey: (input: object) => ['project.getChatReplay', input] },
			getProjectChats: { queryKey: () => ['project.getProjectChats'] },
		},
	},
	trpcClient: {},
}));

vi.mock('@/queries/use-chat-query', () => ({
	useChatQuery: () => ({ data: undefined }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentMessagesGetter: () => () => [],
}));

describe('FeedbackDialog', () => {
	afterEach(cleanup);

	it('shows positive feedback wording', () => {
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} isPending={false} vote='up' />);

		expect(screen.getByText('What went well?')).toBeDefined();
		expect(screen.getByPlaceholderText('Tell us what worked well (optional)')).toBeDefined();
	});

	it('preserves negative feedback wording', () => {
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} isPending={false} vote='down' />);

		expect(screen.getByText('What went wrong?')).toBeDefined();
		expect(screen.getByPlaceholderText('Tell us what could be better (optional)')).toBeDefined();
	});

	it('submits trimmed text or undefined when empty', () => {
		const onSubmit = vi.fn();
		render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isPending={false} vote='up' />);

		fireEvent.change(screen.getByPlaceholderText('Tell us what worked well (optional)'), {
			target: { value: '  Clear and useful  ' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenNthCalledWith(1, 'Clear and useful');
		expect(onSubmit).toHaveBeenNthCalledWith(2, undefined);
	});
});

describe('AssistantMessageActions feedback', () => {
	afterEach(() => {
		cleanup();
		submitFeedbackMock.mockReset();
	});

	it('confirms the submission and keeps the selected vote highlighted', async () => {
		submitFeedbackMock.mockResolvedValue({ messageId: 'message-1', vote: 'down', explanation: null });
		renderActions();

		fireEvent.click(screen.getByRole('button', { name: 'Bad response' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect((await screen.findByRole('status')).textContent).toBe('Thanks for your feedback!');
		expect(screen.getByRole('button', { name: 'Bad response' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: 'Good response' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('tells the user when the submission fails', async () => {
		submitFeedbackMock.mockRejectedValue(new Error('Network error'));
		renderActions();

		fireEvent.click(screen.getByRole('button', { name: 'Good response' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect((await screen.findByRole('alert')).textContent).toBe("Couldn't send feedback. Please try again.");
		expect(screen.queryByRole('status')).toBeNull();
	});
});

function renderActions() {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	const message = { id: 'message-1', role: 'assistant', parts: [] } as unknown as UIMessage;

	return render(
		<QueryClientProvider client={queryClient}>
			<AssistantMessageActions message={message} chatId='chat-1' />
		</QueryClientProvider>,
	);
}
