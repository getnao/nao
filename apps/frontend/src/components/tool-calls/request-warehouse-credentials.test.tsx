// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestWarehouseCredentialsToolCall } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => {
	const createMutation = () => ({ error: null, isPending: false, mutateAsync: vi.fn(), reset: vi.fn() });
	return {
		isCardScrolledAbove: false,
		latestJob: null as Record<string, unknown> | null,
		messages: [] as never[],
		queueOrSendMessage: vi.fn().mockResolvedValue(undefined),
		invalidateQueries: vi.fn(),
		mutations: {
			validate: createMutation(),
			start: createMutation(),
			retry: createMutation(),
		},
	};
});

vi.mock('@tanstack/react-query', () => ({
	useMutation: ({ key }: { key: keyof typeof mocks.mutations }) => mocks.mutations[key],
	useQuery: () => ({ data: mocks.latestJob, isPending: false }),
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		chatId: 'chat-1',
		queueOrSendMessage: mocks.queueOrSendMessage,
	}),
	useAgentMessagesSelector: (selector: (messages: never[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/main', () => ({
	trpc: {
		onboarding: {
			validateWarehouseCredentials: { mutationOptions: () => ({ key: 'validate' }) },
			startWarehouseProvisioning: { mutationOptions: () => ({ key: 'start' }) },
			retryWarehouseProvisioning: { mutationOptions: () => ({ key: 'retry' }) },
			getLatestWarehouseProvisioningJob: {
				queryOptions: () => ({ queryKey: ['latest-job'] }),
				queryKey: () => ['latest-job'],
			},
			getWarehouseProvisioningStatus: {
				queryOptions: ({ jobId }: { jobId: string }) => ({ queryKey: ['job', jobId] }),
			},
		},
	},
}));

vi.mock('@/hooks/use-is-scrolled-above', () => ({
	useIsScrolledAbove: () => mocks.isCardScrolledAbove,
}));

vi.mock('@/contexts/onboarding-floating-slot', () => ({
	OnboardingFloatingContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid='floating-slot'>{children}</div>
	),
}));

vi.mock('./warehouse-credentials', () => ({
	buildWarehouseCredentials: () => ({ host: 'localhost' }),
}));

vi.mock('./warehouse-credentials-form', () => ({
	WarehouseCredentialsForm: ({ onSubmit }: { onSubmit: (values: Record<string, never>) => Promise<void> }) => (
		<button type='button' onClick={() => onSubmit({})}>
			Submit credentials
		</button>
	),
}));

afterEach(() => {
	cleanup();
	mocks.isCardScrolledAbove = false;
	mocks.latestJob = null;
	mocks.messages = [];
	vi.clearAllMocks();
	for (const mutation of Object.values(mocks.mutations)) {
		mutation.mutateAsync.mockResolvedValue(undefined);
	}
});

describe('RequestWarehouseCredentialsToolCall', () => {
	it('shows the connection form inline when no setup has started', () => {
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByText('Connect Postgres')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Submit credentials' })).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('validates, starts the setup and reports the submission to the agent', async () => {
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Submit credentials' }));

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({
				text: 'I submitted my Postgres connection details.',
			}),
		);
		expect(mocks.mutations.validate.mutateAsync).toHaveBeenCalledWith({
			provider: 'postgres',
			credentials: { host: 'localhost' },
		});
		expect(mocks.mutations.start.mutateAsync).toHaveBeenCalledWith({
			provider: 'postgres',
			credentials: { host: 'localhost' },
			onboardingChatId: 'chat-1',
		});
	});

	it('does not report to the agent when the connection check fails', async () => {
		mocks.mutations.validate.mutateAsync.mockRejectedValue(new Error('Connection refused'));
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Submit credentials' }));

		await waitFor(() => expect(mocks.mutations.validate.mutateAsync).toHaveBeenCalled());
		expect(mocks.mutations.start.mutateAsync).not.toHaveBeenCalled();
		expect(mocks.queueOrSendMessage).not.toHaveBeenCalled();
	});

	it('follows the setup steps while the commands run', () => {
		mocks.latestJob = createJob({ status: 'syncing', logs: 'Syncing tables 42%' });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByText('Setting up Postgres')).toBeTruthy();
		const activeStep = screen.getByRole('listitem', { current: 'step' });
		expect(activeStep.textContent).toContain('Sync warehouse metadata');
		expect(activeStep.textContent).toContain('42%');
	});

	it('lets users skip the business context and tells the agent', () => {
		mocks.latestJob = createJob({ status: 'awaiting_context' });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

		expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({ text: 'Skip the business context for now.' });
		expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
		expect(screen.getByText('Skipped')).toBeTruthy();
	});

	it('asks for the business context again when a new setup starts after a skip', () => {
		mocks.latestJob = createJob({ id: 'job-1', status: 'awaiting_context' });
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);
		fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

		mocks.latestJob = createJob({ id: 'job-2', status: 'awaiting_context' });
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
		expect(screen.queryByText('Skipped')).toBeNull();
	});

	it('offers to skip the business context only while it is requested', () => {
		mocks.latestJob = createJob({ status: 'awaiting_context', businessContextProvided: true });
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);
		expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();

		mocks.latestJob = createJob({ status: 'debugging' });
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);
		expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
	});

	it('lets users retry a failed setup and tells the agent', async () => {
		mocks.latestJob = createJob({
			status: 'failed',
			failedStatus: 'debugging',
			error: 'nao debug failed.',
			logs: 'connection refused',
			canRetry: true,
		});
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByText('Postgres setup needs attention')).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toContain('nao debug failed.');
		expect(screen.getByText('connection refused')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({ text: 'I restarted the Postgres setup.' }),
		);
		expect(mocks.mutations.retry.mutateAsync).toHaveBeenCalledWith({ onboardingChatId: 'chat-1' });
	});

	it('lets users edit the connection details after a failure', () => {
		mocks.latestJob = createJob({ status: 'failed', failedStatus: 'initializing', canRetry: false });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Edit connection details' }));

		expect(screen.getByRole('button', { name: 'Submit credentials' })).toBeTruthy();
	});

	it('shows a completed connection', () => {
		mocks.latestJob = createJob({ status: 'ready' });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByText('Postgres connected')).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('floats a summary of the setup once the card scrolls out of view', () => {
		mocks.isCardScrolledAbove = true;
		mocks.latestJob = createJob({ status: 'syncing', logs: 'Syncing tables 42%' });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		const floating = within(screen.getByTestId('floating-slot'));
		expect(floating.getByText('Setting up Postgres')).toBeTruthy();
		expect(floating.getByText('Sync warehouse metadata · 42%')).toBeTruthy();
		expect(floating.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
	});

	it('offers to retry a failed setup from the floating summary', async () => {
		mocks.isCardScrolledAbove = true;
		mocks.latestJob = createJob({ status: 'failed', failedStatus: 'debugging', canRetry: true });
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		const floating = within(screen.getByTestId('floating-slot'));
		expect(floating.getByText('Stopped at: Check the connection')).toBeTruthy();
		fireEvent.click(floating.getByRole('button', { name: 'Retry' }));

		await waitFor(() =>
			expect(mocks.mutations.retry.mutateAsync).toHaveBeenCalledWith({ onboardingChatId: 'chat-1' }),
		);
	});

	it('does not float the card while it is visible or once the connection is ready', () => {
		mocks.latestJob = createJob({ status: 'syncing' });
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);
		expect(screen.queryByTestId('floating-slot')).toBeNull();

		mocks.isCardScrolledAbove = true;
		mocks.latestJob = createJob({ status: 'ready' });
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);
		expect(screen.queryByTestId('floating-slot')).toBeNull();
	});

	it('collapses older connection forms replaced by a newer request', () => {
		mocks.messages = [
			{
				role: 'assistant',
				parts: [
					{ type: 'tool-request_warehouse_credentials', toolCallId: 'tool-1' },
					{ type: 'tool-request_warehouse_credentials', toolCallId: 'tool-2' },
				],
			},
		] as never[];
		render(<RequestWarehouseCredentialsToolCall toolPart={createToolPart()} />);

		expect(screen.getByText('Postgres connection form replaced by a newer one.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Submit credentials' })).toBeNull();
	});
});

function createToolPart() {
	return {
		type: 'tool-request_warehouse_credentials',
		toolCallId: 'tool-1',
		state: 'output-available',
		input: { provider: 'postgres' },
		output: { provider: 'postgres', status: 'credentials-required' },
	} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
}

function createJob(overrides: Record<string, unknown>) {
	return {
		id: 'job-1',
		provider: 'postgres',
		status: 'queued',
		failedStatus: null,
		error: null,
		logs: null,
		businessContextProvided: false,
		canRetry: false,
		...overrides,
	};
}
