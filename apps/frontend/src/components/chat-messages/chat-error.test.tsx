// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ChatError } from './chat-error';

const mocks = vi.hoisted(() => ({
	access: {
		canManageBilling: true,
		organizationId: 'organization-id',
		trialAvailable: false,
	},
	clearError: vi.fn(),
	copy: vi.fn(),
	error: null as Error | null,
	hasAccessData: true,
	openBilling: vi.fn(),
	queryOptions: vi.fn(),
	queryState: {
		isError: false,
		isFetching: false,
		isPending: false,
	},
	refetchAccess: vi.fn(async () => undefined),
	resendMessage: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { enabled?: boolean }) => {
		mocks.queryOptions(options);
		return {
			data: options.enabled === false || !mocks.hasAccessData ? undefined : mocks.access,
			...mocks.queryState,
			refetch: mocks.refetchAccess,
		};
	},
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		clearError: mocks.clearError,
		error: mocks.error,
		isRunning: false,
		resendMessage: mocks.resendMessage,
	}),
	useAgentMessages: () => [{ id: 'message-id', role: 'user' }],
}));

vi.mock('@/hooks/use-copy-to-clipboard', () => ({
	useCopyToClipboard: () => ({ copy: mocks.copy, isCopied: false }),
}));

vi.mock('@/hooks/use-open-organization-billing', () => ({
	useOpenOrganizationBilling: () => mocks.openBilling,
}));

vi.mock('@/main', () => ({
	trpc: {
		billing: { getAccess: { queryOptions: () => ({ queryKey: ['billing-access'] }) } },
	},
}));

beforeEach(() => {
	mocks.access = {
		canManageBilling: true,
		organizationId: 'organization-id',
		trialAvailable: false,
	};
	mocks.hasAccessData = true;
	mocks.queryState = {
		isError: false,
		isFetching: false,
		isPending: false,
	};
	mocks.error = new Error(
		JSON.stringify({
			error: 'Cloud billing access is restricted. Ask an organization admin to update billing.',
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it('offers billing management and retry actions for a billing access error', async () => {
	render(<ChatError />);

	expect(screen.getByRole('status').textContent).toContain('A subscription is needed to continue chatting.');

	fireEvent.click(screen.getByRole('button', { name: 'Manage billing' }));
	expect(mocks.openBilling).toHaveBeenCalledWith('organization-id');

	fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
	await waitFor(() => {
		expect(mocks.clearError).toHaveBeenCalledOnce();
		expect(mocks.resendMessage).toHaveBeenCalledWith({ messageId: 'message-id' });
	});
});

it('offers the free trial for an eligible billing access error', () => {
	mocks.access.trialAvailable = true;

	render(<ChatError />);

	expect(screen.getByText('Start your free trial, then retry your message.')).toBeTruthy();
});

it('directs trial-eligible members to an organization admin without offering billing management', () => {
	mocks.access.canManageBilling = false;
	mocks.access.trialAvailable = true;

	render(<ChatError />);

	expect(
		screen.getByText('Ask an organization admin to start the free trial, then retry your message.'),
	).toBeTruthy();
	expect(screen.queryByText('Start your free trial, then retry your message.')).toBeNull();
	expect(screen.getByText('Ask an organization admin to manage billing.')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
});

it('shows billing access loading state while checking who can manage billing', () => {
	mocks.hasAccessData = false;
	mocks.queryState.isPending = true;

	render(<ChatError />);

	expect(screen.getByText('Loading billing details...')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
});

it('retries a failed billing access refetch and clears the error', async () => {
	mocks.queryState.isError = true;
	mocks.refetchAccess.mockImplementationOnce(async () => {
		mocks.queryState.isError = false;
		return { data: mocks.access } as never;
	});

	const { rerender } = render(<ChatError />);

	expect(screen.getByText('Billing details could not be loaded.')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Retry billing details' }));
	await waitFor(() => expect(mocks.refetchAccess).toHaveBeenCalledOnce());

	rerender(<ChatError />);
	expect(screen.queryByText('Billing details could not be loaded.')).toBeNull();
	expect(screen.getByRole('button', { name: 'Manage billing' })).toBeTruthy();
});

it('shows parsed provider details for a non-billing error without loading billing access', () => {
	mocks.error = new Error(
		JSON.stringify({
			error: {
				code: 'provider_error',
				message: 'Provider request failed.',
				requestId: 'request-id',
			},
		}),
	);

	render(<ChatError />);

	expect(screen.getByText('provider_error')).toBeTruthy();
	expect(screen.getByText('Provider request failed.')).toBeTruthy();
	expect(screen.getByText('request-id')).toBeTruthy();
	expect(mocks.queryOptions).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));

	fireEvent.click(screen.getByRole('button', { name: 'Copy provider request ID' }));
	expect(mocks.copy).toHaveBeenCalledWith('request-id');
});
