// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver } from '../helpers/browser-stubs';
import { createTestQueryClient } from '../helpers/query-client';
import { EmailRecipientsInput } from '@/components/email-recipients-input';
import { TooltipProvider } from '@/components/ui/tooltip';

const MEMBERS = [
	{ email: 'ada@example.com', name: 'Ada Lovelace' },
	{ email: 'Bea@example.com', name: 'Bea' },
];

vi.mock('@/main', () => ({
	trpc: {
		automation: {
			listEmailRecipients: {
				queryOptions: () => ({
					queryKey: ['automation-email-recipients'],
					queryFn: async () => MEMBERS,
					initialData: MEMBERS,
				}),
			},
		},
	},
}));

stubResizeObserver();

afterEach(cleanup);

describe('EmailRecipientsInput', () => {
	it('includes the address being typed so saving mid-typing keeps it', () => {
		const changes = renderInput([]);

		typeDraft('ada@example.com');

		expect(changes.at(-1)).toEqual(['ada@example.com']);
		expect(screen.queryByRole('button', { name: 'Remove ada@example.com' })).toBeNull();
	});

	it.each([
		{ text: 'ada@example.com, BEA@example.com,', recipients: ['ada@example.com', 'bea@example.com'] },
		{ text: 'ada@example.com bea@example.com;', recipients: ['ada@example.com', 'bea@example.com'] },
		{ text: 'ada@example.com,Ada@example.com,', recipients: ['ada@example.com'] },
	])('turns "$text" into one pill per address', ({ text, recipients }) => {
		const changes = renderInput([]);

		typeDraft(text);

		expect(changes.at(-1)).toEqual(recipients);
		expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(recipients.length);
	});

	it('adds a member picked by name as a pill and stops suggesting them', () => {
		const changes = renderInput([]);

		typeDraft('lovelace');
		fireEvent.click(screen.getByRole('option', { name: /ada@example.com/ }));

		expect(changes.at(-1)).toEqual(['ada@example.com']);
		expect(screen.getByRole('button', { name: 'Remove ada@example.com' })).toBeTruthy();

		typeDraft('example');

		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Bea@example.comBea']);
	});

	it('flags only the recipients who are not members the user can share with', () => {
		renderInput(['outsider@example.com', 'bea@example.com']);

		expect(getPill('outsider@example.com').getAttribute('aria-invalid')).toBe('true');
		expect(getPill('bea@example.com').getAttribute('aria-invalid')).toBe('false');
	});

	it('removes the last recipient on Backspace in an empty draft', () => {
		const changes = renderInput(['ada@example.com', 'bea@example.com']);

		fireEvent.keyDown(getInput(), { key: 'Backspace' });

		expect(changes.at(-1)).toEqual(['ada@example.com']);
	});
});

function renderInput(initialRecipients: string[]): string[][] {
	const changes: string[][] = [];

	function ControlledInput() {
		const [recipients, setRecipients] = useState(initialRecipients);
		return (
			<EmailRecipientsInput
				recipients={recipients}
				error={null}
				disabled={false}
				onChange={(nextRecipients) => {
					changes.push(nextRecipients);
					setRecipients(nextRecipients);
				}}
			/>
		);
	}

	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<TooltipProvider>
				<ControlledInput />
			</TooltipProvider>
		</QueryClientProvider>,
	);
	return changes;
}

function typeDraft(text: string) {
	fireEvent.focus(getInput());
	fireEvent.change(getInput(), { target: { value: text, selectionStart: text.length } });
}

function getInput(): HTMLInputElement {
	return screen.getByRole('combobox', { name: 'Email recipients' });
}

function getPill(recipient: string): HTMLElement {
	return screen.getByText(recipient).parentElement!;
}
