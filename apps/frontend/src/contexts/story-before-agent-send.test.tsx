// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	runWithStoryBeforeAgentSend,
	StoryBeforeAgentSendProvider,
	useRegisterStoryBeforeAgentSend,
	useStoryBeforeAgentSend,
} from './story-before-agent-send';
import type { BeforeAgentSendResult } from './story-before-agent-send';

function SendHarness({ guard, send }: { guard: () => Promise<BeforeAgentSendResult>; send: () => Promise<void> }) {
	const beforeAgentSend = useStoryBeforeAgentSend();
	useRegisterStoryBeforeAgentSend({ chatId: 'chat-1', enabled: true, guard });

	return (
		<button
			onClick={async () => {
				await runWithStoryBeforeAgentSend({
					beforeSend: () => beforeAgentSend.run('chat-1'),
					send,
				});
			}}
		>
			Send
		</button>
	);
}

describe('StoryBeforeAgentSendProvider', () => {
	afterEach(cleanup);

	it('awaits a successful dirty Story save before continuing the send', async () => {
		const events: string[] = [];
		let finishSave = () => {};
		let finishSend = () => {};
		const save = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishSave = () => resolve();
				}),
		);
		const guard = vi.fn(async () => {
			events.push('save started');
			await save();
			events.push('save finished');
			return {
				canSend: true,
				afterSend: () => events.push('preview'),
			};
		});
		const send = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					events.push('send invoked');
					finishSend = () => {
						events.push('send finished');
						resolve();
					};
				}),
		);
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect(guard).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledOnce();
		expect(send).not.toHaveBeenCalled();
		expect(events).toEqual(['save started']);

		finishSave();
		await waitFor(() => expect(events).toEqual(['save started', 'save finished', 'send invoked', 'preview']));
		expect(send).toHaveBeenCalledOnce();

		finishSend();
		await waitFor(() =>
			expect(events).toEqual(['save started', 'save finished', 'send invoked', 'preview', 'send finished']),
		);
	});

	it('does not send when the Story save fails', async () => {
		const save = vi.fn(async (): Promise<'saved' | 'failed'> => 'failed');
		const preview = vi.fn();
		const guard = vi.fn(async () => ({ canSend: (await save()) === 'saved', afterSend: preview }));
		const send = vi.fn(async () => {});
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		await waitFor(() => expect(guard).toHaveBeenCalledOnce());
		expect(save).toHaveBeenCalledOnce();
		expect(send).not.toHaveBeenCalled();
		expect(preview).not.toHaveBeenCalled();
	});

	it('does not send or change modes when the Story code is invalid', async () => {
		const preview = vi.fn();
		const guard = vi.fn(async () => ({ canSend: false, afterSend: preview }));
		const send = vi.fn(async () => {});
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		await waitFor(() => expect(guard).toHaveBeenCalledOnce());
		expect(send).not.toHaveBeenCalled();
		expect(preview).not.toHaveBeenCalled();
	});

	it('sends normally without changing modes when the Story is clean', async () => {
		const preview = vi.fn();
		const guard = vi.fn(async () => ({ canSend: true }));
		const send = vi.fn(async () => {});
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		await waitFor(() => expect(send).toHaveBeenCalledOnce());
		expect(preview).not.toHaveBeenCalled();
	});
});

describe('runWithStoryBeforeAgentSend', () => {
	it('invokes an allowed queued send once before afterSend', async () => {
		const events: string[] = [];
		let finishSend = () => {};
		const submitQueuedMessageNow = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					events.push('send invoked');
					finishSend = resolve;
				}),
		);
		const promise = runWithStoryBeforeAgentSend({
			beforeSend: async () => ({
				canSend: true,
				afterSend: () => events.push('after send'),
			}),
			send: () => submitQueuedMessageNow(),
		});

		await waitFor(() => expect(events).toEqual(['send invoked', 'after send']));
		expect(submitQueuedMessageNow).toHaveBeenCalledOnce();

		finishSend();
		await promise;
	});

	it('does not invoke a blocked queued send or afterSend', async () => {
		const afterSend = vi.fn();
		const submitQueuedMessageNow = vi.fn(async () => {});

		const sent = await runWithStoryBeforeAgentSend({
			beforeSend: async () => ({ canSend: false, afterSend }),
			send: submitQueuedMessageNow,
		});

		expect(sent).toBe(false);
		expect(submitQueuedMessageNow).not.toHaveBeenCalled();
		expect(afterSend).not.toHaveBeenCalled();
	});
});
