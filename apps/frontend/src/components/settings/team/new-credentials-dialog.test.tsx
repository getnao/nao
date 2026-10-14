// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewCredentialsDialog } from './new-credentials-dialog';

const mocks = vi.hoisted(() => ({
	useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: mocks.useQuery,
}));
vi.mock('@/main', () => ({
	trpc: {
		authConfig: {
			smtp: { isSetup: { queryOptions: () => ({ queryKey: ['smtp-is-setup'] }) } },
		},
	},
}));

const credentials = { email: 'person@example.com', password: 'temporary-password' };
const smtpNotice = /No email was sent because SMTP is not set up/;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('NewCredentialsDialog SMTP notice', () => {
	it('shows the notice when SMTP is not set up', () => {
		mocks.useQuery.mockReturnValue({ data: false });
		renderDialog();

		expect(screen.getByText(smtpNotice)).toBeTruthy();
	});

	it('hides the notice when SMTP is set up', () => {
		mocks.useQuery.mockReturnValue({ data: true });
		renderDialog();

		expect(screen.queryByText(smtpNotice)).toBeNull();
		expect(screen.getByText('temporary-password')).toBeTruthy();
	});

	it('hides the notice while the SMTP status is loading', () => {
		mocks.useQuery.mockReturnValue({ data: undefined });
		renderDialog();

		expect(screen.queryByText(smtpNotice)).toBeNull();
	});
});

function renderDialog() {
	render(<NewCredentialsDialog open onOpenChange={vi.fn()} credentials={credentials} />);
}
