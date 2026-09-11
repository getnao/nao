// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeedbackDialog } from './assistant-message-actions';

vi.mock('@/main', () => ({
	trpc: {},
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
