// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestWarehouseCredentialsToolCall } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	isRunning: true,
	jobStatus: 'awaiting_context',
	jobError: null as Error | null,
	activeJobId: 'job-1' as string | undefined,
	activeJobIsFetched: true,
	messages: [] as never[],
	queueOrSendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({
		error: null,
		isPending: false,
		mutateAsync: vi.fn(),
		reset: vi.fn(),
	}),
	useQuery: (options: { queryKey: string[] }) =>
		options.queryKey[0] === 'active-job'
			? {
					data: mocks.activeJobId ? { id: mocks.activeJobId, provider: 'postgres' } : undefined,
					isFetched: mocks.activeJobIsFetched,
				}
			: {
					data:
						options.queryKey[1] && !mocks.jobError
							? { provider: 'postgres', status: mocks.jobStatus }
							: undefined,
					isError: Boolean(options.queryKey[1] && mocks.jobError),
					error: options.queryKey[1] ? mocks.jobError : null,
				},
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		chatId: 'chat-1',
		isRunning: mocks.isRunning,
		queueOrSendMessage: mocks.queueOrSendMessage,
	}),
	useAgentMessagesSelector: (selector: (messages: never[]) => unknown) => selector(mocks.messages),
}));

vi.mock('@/main', () => ({
	trpc: {
		onboarding: {
			validateWarehouseCredentials: {
				mutationOptions: () => ({}),
			},
			getActiveWarehouseProvisioningJob: {
				queryOptions: () => ({ queryKey: ['active-job'] }),
			},
			getWarehouseProvisioningStatus: {
				queryOptions: ({ jobId }: { jobId: string }) => ({ queryKey: ['job', jobId] }),
			},
			startWarehouseProvisioning: {
				mutationOptions: () => ({}),
			},
		},
	},
}));

vi.mock('./warehouse-credentials-form', () => ({
	WarehouseCredentialsForm: ({
		onCancel,
		onValuesChange,
		onValidatedFingerprintChange,
	}: {
		onCancel: () => void;
		onValuesChange: (values: Record<string, never>) => void;
		onValidatedFingerprintChange: (fingerprint: string) => void;
	}) => (
		<button
			type='button'
			onClick={() => {
				onValuesChange({});
				onValidatedFingerprintChange(JSON.stringify({}));
				onCancel();
			}}
		>
			Verify credentials
		</button>
	),
}));

afterEach(() => {
	cleanup();
	mocks.isRunning = true;
	mocks.jobStatus = 'awaiting_context';
	mocks.jobError = null;
	mocks.activeJobId = 'job-1';
	mocks.activeJobIsFetched = true;
	mocks.messages = [];
	vi.clearAllMocks();
});

describe('RequestWarehouseCredentialsToolCall', () => {
	it('shows a verified state that lets users edit their credentials', async () => {
		mocks.activeJobId = undefined;
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Enter credentials' }));
		fireEvent.click(screen.getByRole('button', { name: 'Verify credentials' }));

		await screen.findByText('Postgres credentials verified');
		expect(screen.getByRole('button', { name: 'Edit credentials' })).toBeTruthy();
	});

	it('does not show default credentials for a restored setup', async () => {
		mocks.jobStatus = 'initializing';
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await screen.findByText('Postgres credentials verified');
		expect(screen.getByText('Your connection is being set up.')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'View setup' }));
		expect(screen.getByText(/Your connection details are unavailable in this session/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Verify credentials' })).toBeNull();
	});

	it('waits for the current turn to finish before requesting business context', async () => {
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() => expect(mocks.queueOrSendMessage).not.toHaveBeenCalled());

		mocks.isRunning = false;
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({
				text: '[internal:onboarding-context-request] jobId=job-1',
			}),
		);
	});

	it('keeps the completed warehouse connection visible', async () => {
		mocks.jobStatus = 'ready';
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		expect(await screen.findByText('Postgres credentials verified')).toBeTruthy();
		expect(screen.getByText('Your warehouse connection is ready.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'View setup' })).toBeTruthy();
	});

	it('waits for the active job before falling back to a persisted job ID', async () => {
		mocks.isRunning = false;
		mocks.activeJobId = undefined;
		mocks.activeJobIsFetched = false;
		mocks.messages = [
			{
				role: 'assistant',
				parts: [
					{
						type: 'tool-generate_onboarding_rules',
						state: 'output-available',
						output: { jobId: 'old-job' },
					},
				],
			},
		] as never[];
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		const view = render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() => expect(mocks.queueOrSendMessage).not.toHaveBeenCalled());

		mocks.activeJobId = 'new-job';
		mocks.activeJobIsFetched = true;
		view.rerender(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await waitFor(() =>
			expect(mocks.queueOrSendMessage).toHaveBeenCalledWith({
				text: '[internal:onboarding-context-request] jobId=new-job',
			}),
		);
	});

	it('allows retrying when a restored provisioning job cannot be loaded', async () => {
		mocks.jobError = new Error('Warehouse setup job not found');
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		expect(await screen.findByText('Postgres setup needs attention')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Review setup' }));
		expect(await screen.findByText('Warehouse setup job not found')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('button', { name: 'Verify credentials' })).toBeTruthy();
	});
});
