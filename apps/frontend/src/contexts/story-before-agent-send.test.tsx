// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	StoryBeforeAgentSendProvider,
	useRegisterStoryBeforeAgentSend,
	useStoryBeforeAgentSend,
} from './story-before-agent-send';

function SendHarness({ guard, send }: { guard: () => Promise<boolean>; send: () => void }) {
	const beforeAgentSend = useStoryBeforeAgentSend();
	useRegisterStoryBeforeAgentSend({ chatId: 'chat-1', enabled: true, guard });

	return (
		<button
			onClick={async () => {
				if (await beforeAgentSend.run('chat-1')) {
					send();
				}
			}}
		>
			Send
		</button>
	);
}

describe('StoryBeforeAgentSendProvider', () => {
	afterEach(cleanup);

	it('awaits the active Story save before sending', async () => {
		let finishSave: (saved: boolean) => void = () => {};
		const guard = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					finishSave = resolve;
				}),
		);
		const send = vi.fn();
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		expect(guard).toHaveBeenCalledOnce();
		expect(send).not.toHaveBeenCalled();

		finishSave(true);
		await waitFor(() => expect(send).toHaveBeenCalledOnce());
	});

	it('does not send when the Story save fails', async () => {
		const guard = vi.fn(async () => false);
		const send = vi.fn();
		render(
			<StoryBeforeAgentSendProvider>
				<SendHarness guard={guard} send={send} />
			</StoryBeforeAgentSendProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Send' }));
		await waitFor(() => expect(guard).toHaveBeenCalledOnce());
		expect(send).not.toHaveBeenCalled();
	});
});
