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

	it.each([
		['  Clear and useful  ', 'Clear and useful'],
		['   ', undefined],
	])('submits %j as %j', (input, expected) => {
		const onSubmit = vi.fn();
		renderFeedbackDialog('up', onSubmit);

		fireEvent.change(screen.getByRole('textbox'), { target: { value: input } });
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenCalledWith(expected, 'up');
	});

	it('submits the vote picked in the dialog over the preselected one', () => {
		const onSubmit = vi.fn();
		renderFeedbackDialog('up', onSubmit);

		fireEvent.click(screen.getByRole('button', { name: 'Bad response' }));
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenCalledWith(undefined, 'down');
	});
});

function renderFeedbackDialog(vote: 'up' | 'down', onSubmit = vi.fn()) {
	render(<FeedbackDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} isPending={false} defaultVote={vote} />);
}
