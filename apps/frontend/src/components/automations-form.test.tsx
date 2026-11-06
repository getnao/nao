// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailRecipientsInput } from './automations-form';

const { recipientOptions } = vi.hoisted(() => ({
	recipientOptions: [] as { email: string; name: string }[],
}));

vi.mock('@/main', () => ({
	trpc: {
		automation: {
			validateEmailRecipients: {
				queryOptions: () => ({
					queryKey: ['validate-automation-email-recipients'],
					queryFn: async () => ({ nonMemberRecipients: [] }),
				}),
			},
			listEmailRecipients: {
				queryOptions: () => ({
					queryKey: ['list-automation-email-recipients'],
					queryFn: async () => recipientOptions,
					initialData: recipientOptions,
				}),
			},
		},
	},
}));

afterEach(() => {
	recipientOptions.splice(0, recipientOptions.length);
	cleanup();
});

describe('EmailRecipientsInput', () => {
	it('includes the recipient being typed in the parent value', () => {
		const changes: string[][] = [];
		const queryClient = new QueryClient();

		function ControlledInput() {
			const [recipients, setRecipients] = useState<string[]>([]);
			return (
				<QueryClientProvider client={queryClient}>
					<EmailRecipientsInput
						recipients={recipients}
						error={null}
						disabled={false}
						onChange={(nextRecipients) => {
							changes.push(nextRecipients);
							setRecipients(nextRecipients);
						}}
					/>
				</QueryClientProvider>
			);
		}

		render(<ControlledInput />);
		fireEvent.change(screen.getByRole('combobox', { name: 'Email recipients' }), {
			target: { value: 'member@example.com' },
		});

		expect(changes.at(-1)).toEqual(['member@example.com']);
		expect(screen.queryByText('member@example.com')).toBeNull();
	});

	it('adds checked project members', () => {
		recipientOptions.push({ email: 'ada@example.com', name: 'Ada' }, { email: 'bea@example.com', name: 'Bea' });
		const changes: string[][] = [];
		const queryClient = new QueryClient();

		function ControlledInput() {
			const [recipients, setRecipients] = useState<string[]>([]);
			return (
				<QueryClientProvider client={queryClient}>
					<EmailRecipientsInput
						recipients={recipients}
						error={null}
						disabled={false}
						onChange={(nextRecipients) => {
							changes.push(nextRecipients);
							setRecipients(nextRecipients);
						}}
					/>
				</QueryClientProvider>
			);
		}

		render(<ControlledInput />);
		const input = screen.getByRole('combobox', { name: 'Email recipients' });
		fireEvent.focus(input);
		fireEvent.click(screen.getByRole('option', { name: /ada@example.com/ }));
		fireEvent.click(screen.getByRole('option', { name: /bea@example.com/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

		expect(changes.at(-1)).toEqual(['ada@example.com', 'bea@example.com']);
	});
});
