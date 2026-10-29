// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestWarehouseCredentialsToolCall } from './request-warehouse-credentials';
import type { ToolCallComponentProps } from '.';

const mocks = vi.hoisted(() => ({
	isRunning: true,
	jobStatus: 'awaiting_context',
	jobError: null as Error | null,
	jobSetupError: undefined as string | undefined,
	latestJobId: 'job-1' as string | undefined,
	latestJobIsFetched: true,
	messages: [] as never[],
	queueOrSendMessage: vi.fn().mockResolvedValue(undefined),
	validateCredentials: vi.fn().mockResolvedValue({
		valid: true,
		schemas: [{ schema: 'public', tables: ['customers', 'orders'] }],
	}),
	validateNotion: vi.fn().mockResolvedValue({
		valid: true,
		pages: [{ url: 'https://notion.so/page', title: 'Company context' }],
	}),
	validateConfluence: vi.fn().mockResolvedValue({
		valid: true,
		pages: [{ url: 'https://acme.atlassian.net/wiki/pages/123', title: 'Company context' }],
	}),
	resetSubmitContext: vi.fn(),
	startProvisioning: vi.fn().mockResolvedValue({ jobId: 'new-job', status: 'queued' }),
	submitContextSources: vi.fn().mockResolvedValue({ status: 'syncing' }),
	uploadContextFile: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useMutation: (options: { mutationKey?: string[] }) => ({
		error: null,
		isPending: false,
		mutateAsync:
			options.mutationKey?.[0] === 'validate-credentials'
				? mocks.validateCredentials
				: options.mutationKey?.[0] === 'validate-notion'
					? mocks.validateNotion
					: options.mutationKey?.[0] === 'validate-confluence'
						? mocks.validateConfluence
						: options.mutationKey?.[0] === 'submit-context-sources'
							? mocks.submitContextSources
							: mocks.startProvisioning,
		reset: options.mutationKey?.[0] === 'submit-context-sources' ? mocks.resetSubmitContext : vi.fn(),
	}),
	useQuery: (options: { queryKey: string[] }) =>
		options.queryKey[0] === 'latest-job'
			? {
					data: mocks.latestJobId ? { id: mocks.latestJobId, provider: 'postgres' } : undefined,
					isFetched: mocks.latestJobIsFetched,
				}
			: options.queryKey[0] === 'github-available'
				? { data: true, isLoading: false }
				: options.queryKey[0] === 'github-status'
					? { data: { connected: false }, error: null }
					: {
							data:
								options.queryKey[1] && !mocks.jobError
									? {
											provider: 'postgres',
											status: mocks.jobStatus,
											error: mocks.jobSetupError,
										}
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
				mutationOptions: () => ({ mutationKey: ['validate-credentials'] }),
			},
			validateNotionContext: {
				mutationOptions: () => ({ mutationKey: ['validate-notion'] }),
			},
			validateConfluenceContext: {
				mutationOptions: () => ({ mutationKey: ['validate-confluence'] }),
			},
			getLatestWarehouseProvisioningJob: {
				queryOptions: () => ({ queryKey: ['latest-job'] }),
			},
			getWarehouseProvisioningStatus: {
				queryOptions: ({ jobId }: { jobId: string }) => ({ queryKey: ['job', jobId] }),
			},
			startWarehouseProvisioning: {
				mutationOptions: () => ({ mutationKey: ['start-provisioning'] }),
			},
			submitWarehouseContextSources: {
				mutationOptions: () => ({ mutationKey: ['submit-context-sources'] }),
			},
		},
		github: {
			isAvailable: {
				queryOptions: () => ({ queryKey: ['github-available'] }),
			},
			getStatus: {
				queryOptions: () => ({ queryKey: ['github-status'] }),
			},
		},
	},
}));

vi.mock('./warehouse-credentials-form', () => ({
	WarehouseCredentialsForm: ({
		onCancel,
		onSubmit,
		onValidate,
		onValuesChange,
		onValidatedFingerprintChange,
	}: {
		onCancel: () => void;
		onSubmit: (values: Record<string, never>) => Promise<void>;
		onValidate: (values: Record<string, never>) => Promise<void>;
		onValuesChange: (values: Record<string, never>) => void;
		onValidatedFingerprintChange: (fingerprint: string) => void;
	}) => (
		<>
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
			<button
				type='button'
				onClick={() => {
					onValuesChange({});
					void onValidate({}).then(() => onValidatedFingerprintChange(JSON.stringify({})));
				}}
			>
				Discover tables
			</button>
			<button type='button' onClick={() => void onSubmit({})}>
				Next
			</button>
		</>
	),
}));

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		}),
	);
});

afterEach(() => {
	cleanup();
	mocks.isRunning = true;
	mocks.jobStatus = 'awaiting_context';
	mocks.jobError = null;
	mocks.jobSetupError = undefined;
	mocks.latestJobId = 'job-1';
	mocks.latestJobIsFetched = true;
	mocks.messages = [];
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('RequestWarehouseCredentialsToolCall', () => {
	it('shows a verified state that lets users edit their credentials', async () => {
		mocks.latestJobId = undefined;
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

	it('shows business context as a separate card after warehouse verification', async () => {
		mocks.jobStatus = 'awaiting_sources';
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await screen.findByText('Postgres database verified');
		expect(screen.getByRole('button', { name: 'Skip' }).className).toContain('text-muted-foreground/60');
		fireEvent.click(screen.getByRole('button', { name: 'Add business context' }));
		fireEvent.change(screen.getByLabelText('Company website'), {
			target: { value: 'acme.example' },
		});
		fireEvent.change(screen.getByLabelText('Tell us more about your business'), {
			target: { value: 'We rent bicycles.' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await screen.findByRole('heading', { name: 'Notion' });
		fireEvent.click(screen.getByRole('button', { name: 'Sync with context' }));
		await waitFor(() =>
			expect(mocks.submitContextSources).toHaveBeenCalledWith({
				jobId: 'job-1',
				businessContext: {
					additionalContext: 'Website: https://acme.example\n\nAbout the business: We rent bicycles.',
				},
				contextSources: {},
			}),
		);
	});

	it('reuses uploaded context files when retrying a submission with a lost response', async () => {
		mocks.jobStatus = 'awaiting_sources';
		mocks.uploadContextFile.mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		});
		mocks.submitContextSources.mockRejectedValueOnce(new Error('Response lost'));
		vi.stubGlobal('fetch', mocks.uploadContextFile);
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await screen.findByText('Postgres database verified');
		fireEvent.click(screen.getByRole('button', { name: 'Add business context' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		const file = new File(['# Company handbook'], 'handbook.md', { type: 'text/markdown' });
		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [file] },
		});

		await screen.findByText('handbook.md');
		fireEvent.click(screen.getByRole('button', { name: 'Sync with context' }));

		await waitFor(() => expect(mocks.submitContextSources).toHaveBeenCalledOnce());
		const submitButton = screen.getByRole('button', { name: 'Sync with context' });
		await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(submitButton);
		await waitFor(() => expect(mocks.submitContextSources).toHaveBeenCalledTimes(2));

		expect(mocks.uploadContextFile).toHaveBeenNthCalledWith(1, '/api/onboarding/context-files?jobId=job-1', {
			method: 'DELETE',
		});
		expect(mocks.uploadContextFile).toHaveBeenCalledWith(
			'/api/onboarding/context-files?jobId=job-1',
			expect.objectContaining({
				method: 'POST',
				body: expect.any(FormData),
			}),
		);
		expect(mocks.uploadContextFile).toHaveBeenCalledTimes(2);
		expect(mocks.resetSubmitContext).toHaveBeenCalledTimes(2);
		expect(mocks.resetSubmitContext.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.uploadContextFile.mock.invocationCallOrder[0],
		);
		expect(mocks.uploadContextFile.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.submitContextSources.mock.invocationCallOrder[0],
		);
	});

	it('reuploads a previous file selection after replacing it fails', async () => {
		mocks.jobStatus = 'awaiting_sources';
		const successfulResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({}),
		};
		mocks.uploadContextFile.mockResolvedValue(successfulResponse);
		mocks.submitContextSources.mockRejectedValueOnce(new Error('Response lost'));
		vi.stubGlobal('fetch', mocks.uploadContextFile);
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		await screen.findByText('Postgres database verified');
		fireEvent.click(screen.getByRole('button', { name: 'Add business context' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		const handbook = new File(['# Company handbook'], 'handbook.md', { type: 'text/markdown' });
		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [handbook] },
		});
		await screen.findByText('handbook.md');
		fireEvent.click(screen.getByRole('button', { name: 'Sync with context' }));
		await waitFor(() => expect(mocks.submitContextSources).toHaveBeenCalledOnce());

		fireEvent.click(screen.getByRole('button', { name: 'Remove handbook.md' }));
		const replacement = new File(['Replacement'], 'replacement.txt', { type: 'text/plain' });
		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [replacement] },
		});
		await screen.findByText('replacement.txt');
		mocks.uploadContextFile.mockResolvedValueOnce(successfulResponse).mockResolvedValueOnce({
			ok: false,
			json: vi.fn().mockResolvedValue({ error: 'Replacement upload failed.' }),
		});
		fireEvent.click(screen.getByRole('button', { name: 'Sync with context' }));
		await screen.findByText('Replacement upload failed.');

		fireEvent.click(screen.getByRole('button', { name: 'Remove replacement.txt' }));
		fireEvent.change(screen.getByLabelText('Upload business context files'), {
			target: { files: [handbook] },
		});
		await screen.findByText('handbook.md');
		fireEvent.click(screen.getByRole('button', { name: 'Sync with context' }));

		await waitFor(() => expect(mocks.submitContextSources).toHaveBeenCalledTimes(2));
		expect(mocks.uploadContextFile).toHaveBeenCalledTimes(6);
		expect(mocks.uploadContextFile).toHaveBeenNthCalledWith(5, '/api/onboarding/context-files?jobId=job-1', {
			method: 'DELETE',
		});
		expect(mocks.uploadContextFile).toHaveBeenNthCalledWith(
			6,
			'/api/onboarding/context-files?jobId=job-1',
			expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
		);
	});

	it('discovers tables before starting provisioning with the selected tables', async () => {
		mocks.latestJobId = undefined;
		const toolPart = {
			type: 'tool-request_warehouse_credentials',
			toolCallId: 'tool-1',
			state: 'output-available',
			input: { provider: 'postgres' },
			output: { provider: 'postgres', status: 'credentials-required' },
		} as ToolCallComponentProps<'request_warehouse_credentials'>['toolPart'];
		render(<RequestWarehouseCredentialsToolCall toolPart={toolPart} />);

		fireEvent.click(screen.getByRole('button', { name: 'Enter credentials' }));
		expect((screen.getByRole('tab', { name: /Tables/ }) as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByRole('button', { name: /Business context/ })).toBeNull();
		expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain(
			'data-[state=open]:animate-none',
		);
		fireEvent.click(screen.getByRole('button', { name: 'Discover tables' }));
		await waitFor(() => expect(mocks.validateCredentials).toHaveBeenCalledOnce());
		expect(screen.getByText('Postgres credentials verified')).toBeTruthy();
		expect(screen.queryByText('Tables to sync')).toBeNull();
		expect((screen.getByRole('tab', { name: /Tables/ }) as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await screen.findByText('Tables to sync');

		fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
		expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		fireEvent.click(screen.getByRole('button', { name: /Specific selection/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Expand public folder' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'customers table access' }));
		fireEvent.click(screen.getByRole('checkbox', { name: 'orders table access' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		await waitFor(() =>
			expect(mocks.startProvisioning).toHaveBeenCalledWith({
				provider: 'postgres',
				credentials: expect.any(Object),
				tableSelection: {
					mode: 'selected',
					schemas: ['public'],
					tables: [],
				},
				onboardingChatId: 'chat-1',
			}),
		);
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

	it('keeps a failed warehouse setup available for review', async () => {
		mocks.jobStatus = 'failed';
		mocks.jobSetupError = 'nao sync failed. Check the logs for details.';
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
		expect(await screen.findByText('Project setup stopped')).toBeTruthy();
		expect(screen.getByText('nao sync failed. Check the logs for details.')).toBeTruthy();
	});

	it('waits for the latest job before falling back to a persisted job ID', async () => {
		mocks.isRunning = false;
		mocks.latestJobId = undefined;
		mocks.latestJobIsFetched = false;
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

		mocks.latestJobId = 'new-job';
		mocks.latestJobIsFetched = true;
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
