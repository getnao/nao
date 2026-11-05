// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailRecipientsInput } from './automations-form';

vi.mock('@/main', () => ({
	trpc: {
		automation: {
			validateEmailRecipients: {
				queryOptions: () => ({
					queryKey: ['validate-automation-email-recipients'],
					queryFn: async () => ({ nonMemberRecipients: [] }),
				}),
			},
		},
	},
}));

afterEach(cleanup);

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
		fireEvent.change(screen.getByRole('textbox', { name: 'Email recipients' }), {
			target: { value: 'member@example.com' },
		});

		expect(changes.at(-1)).toEqual(['member@example.com']);
		expect(screen.queryByText('member@example.com')).toBeNull();
	});
});
