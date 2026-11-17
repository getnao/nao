// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';

vi.mock('@/main', () => ({
	trpc: {},
}));

describe('FeedbackDialog', () => {
	afterEach(cleanup);

	it.each([
		['shows positive', 'up', 'What went well?', 'Tell us what worked well (optional)'],
		['preserves negative', 'down', 'What went wrong?', 'Tell us what could be better (optional)'],
	] as const)('%s feedback wording', (_scenario, vote, title, placeholder) => {
		renderFeedbackDialog(vote);

		expect(screen.getByText(title)).toBeDefined();
		expect(screen.getByPlaceholderText(placeholder)).toBeDefined();
	});

	it('submits trimmed text or undefined when empty', () => {
		const onSubmit = vi.fn();
		renderFeedbackDialog('up', onSubmit);

		fireEvent.change(screen.getByPlaceholderText('Tell us what worked well (optional)'), {
			target: { value: '  Clear and useful  ' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenNthCalledWith(1, 'Clear and useful');
		expect(onSubmit).toHaveBeenNthCalledWith(2, undefined);
	});
});

function renderFeedbackDialog(vote: 'up' | 'down', onSubmit = vi.fn()) {
	render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isPending={false} vote={vote} />);
}
