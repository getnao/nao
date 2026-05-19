import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Separator } from './ui/separator';
import type { McpState } from '@nao/shared';
import type { LlmProvider } from '@nao/shared/types';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type { PromptHandle } from 'prompt-mentions';
import { ChatPrompt, DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER } from '@/components/chat-input-prompt';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

type IntegrationConfig = {
	email?: {
		enabled: boolean;
		recipients: string[];
		subject?: string;
	};
	slack?: {
		enabled: boolean;
		channelId: string;
	};
	github?: {
		enabled: boolean;
		repositories: string[];
	};
};

export type AutomationFormValue = {
	title: string;
	prompt: string;
	cron: string;
	scheduleDescription?: string;
	modelProvider?: LlmProvider;
	modelId?: string;
	enabled: boolean;
	mcpEnabled: boolean;
	mcpServers?: string[];
	integrations: IntegrationConfig;
};

type AutomationFormProps = {
	id?: string;
	initialValue?: Partial<AutomationFormValue>;
	details?: AutomationDetails;
	submitLabel: string;
	isPending: boolean;
	aside?: ReactNode;
	showSubmitButton?: boolean;
	autoSaveControls?: boolean;
	saveShortcut?: boolean;
	onDirtyChange?: (isDirty: boolean) => void;
	onSubmit: (value: AutomationFormValue) => Promise<void>;
};

type AutomationDetails = {
	enabled: boolean;
	nextRunAt?: Date | string | null;
	lastRunAt?: Date | string | null;
};

type ScheduleOption = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

type SchedulePreset = {
	value: Exclude<ScheduleOption, 'custom'>;
	label: string;
	cron: string;
	description: string;
};

const defaultModelValue = 'default';
const MODE_MENTION_TRIGGER = '#';

const defaultValue: AutomationFormValue = {
	title: '',
	prompt: '',
	cron: '0 9 * * 1',
	scheduleDescription: 'Every Monday at 9am',
	modelProvider: undefined,
	modelId: undefined,
	enabled: true,
	mcpEnabled: false,
	mcpServers: undefined,
	integrations: {},
};

const schedulePresets: SchedulePreset[] = [
	{ value: 'hourly', label: 'Hourly', cron: '0 * * * *', description: 'Hourly' },
	{ value: 'daily', label: 'Daily', cron: '0 9 * * *', description: 'Daily at 9am' },
	{ value: 'weekdays', label: 'Weekdays', cron: '0 9 * * 1-5', description: 'Weekdays at 9am' },
	{ value: 'weekly', label: 'Weekly', cron: '0 9 * * 1', description: 'Weekly on Monday at 9am' },
	{ value: 'monthly', label: 'Monthly', cron: '0 9 1 * *', description: 'Monthly on the 1st at 9am' },
];

export function AutomationForm({
	id,
	initialValue,
	details,
	submitLabel,
	isPending,
	aside,
	showSubmitButton = true,
	autoSaveControls = false,
	saveShortcut = false,
	onDirtyChange,
	onSubmit,
}: AutomationFormProps) {
	const form = useAutomationFormController({
		initialValue,
		isPending,
		autoSaveControls,
		saveShortcut,
		onDirtyChange,
		onSubmit,
	});

	return (
		<form
			ref={form.formRef}
			id={id}
			onSubmit={form.handleSubmit}
			className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]'
		>
			<div className='grid content-start gap-5'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium'>Title</label>
					<Input value={form.value.title} onChange={(event) => form.setTitle(event.target.value)} required />
				</div>

				<div className='grid gap-2'>
					<label className='text-sm font-medium'>Prompt</label>
					<AutomationPromptInput
						promptRef={form.promptRef}
						value={form.value.prompt}
						hasError={form.promptError}
						onChange={form.handlePromptChange}
					/>
					<PromptMentionHints email={form.userEmail} onInsertTrigger={form.handleInsertPromptTrigger} />
				</div>
			</div>

			<div className='grid content-start gap-4'>
				<AutomationSidebarSection title='Details'>
					{details && <AutomationDetailSummary details={details} />}

					<Separator className='my-4 border-1/2' />

					<div className='flex items-center justify-between gap-3'>
						<label className='text-sm text-muted-foreground'>Schedule</label>
						<Select
							value={form.scheduleOption}
							onValueChange={(option) => form.handleScheduleOptionChange(option as ScheduleOption)}
							disabled={form.controlsDisabled}
						>
							<SelectTrigger variant='ghost' className='min-w-0 max-w-40 justify-end px-0 text-right'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{schedulePresets.map((preset) => (
									<SelectItem key={preset.value} value={preset.value}>
										{preset.label}
									</SelectItem>
								))}
								<SelectItem value='custom'>Custom</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{form.scheduleOption === 'custom' && (
						<div className='grid gap-2'>
							<label className='text-xs font-medium text-muted-foreground'>Crontab syntax</label>
							<Input
								value={form.value.cron}
								onChange={(event) => form.setCustomCron(event.target.value)}
								placeholder='0 9 * * 1'
								required
							/>
						</div>
					)}

					<div className='flex items-center justify-between gap-3'>
						<label className='text-sm text-muted-foreground'>Model</label>
						<Select
							value={form.selectedModelValue}
							onValueChange={form.handleModelChange}
							disabled={form.controlsDisabled}
						>
							<SelectTrigger variant='ghost' className='min-w-0 max-w-48 justify-end px-0 text-right'>
								<SelectValue>
									<div className='flex min-w-0 items-center justify-end gap-2'>
										{form.value.modelProvider && (
											<LlmProviderIcon provider={form.value.modelProvider} className='size-4' />
										)}
										<span className='truncate'>{form.selectedModelName ?? 'Default model'}</span>
									</div>
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={defaultModelValue}>Default model</SelectItem>
								{form.availableModels?.map((model) => (
									<SelectItem
										key={`${model.provider}-${model.modelId}`}
										value={`${model.provider}:${model.modelId}`}
									>
										<LlmProviderIcon provider={model.provider} className='size-4' />
										{model.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</AutomationSidebarSection>

				<AutomationSidebarSection title='Integrations'>
					<IntegrationFields
						value={form.value}
						mcpState={form.mcpState}
						emailRecipientsError={form.emailRecipientsError}
						onClearEmailRecipientsError={form.clearEmailRecipientsError}
						onChange={form.handleValueChange}
						onAutoSaveChange={form.handleControlValueChange}
						disabled={form.controlsDisabled}
					/>
				</AutomationSidebarSection>

				{aside}

				{form.submitError && <ErrorMessage message={form.submitError} />}

				{showSubmitButton && (
					<Button type='submit' disabled={isPending} className='w-full'>
						{isPending ? 'Saving...' : submitLabel}
					</Button>
				)}
			</div>
		</form>
	);
}

function useAutomationFormController({
	initialValue,
	isPending,
	autoSaveControls,
	saveShortcut,
	onDirtyChange,
	onSubmit,
}: Pick<
	AutomationFormProps,
	'initialValue' | 'isPending' | 'autoSaveControls' | 'saveShortcut' | 'onDirtyChange' | 'onSubmit'
>) {
	const initialValueSnapshot = serializeAutomationValue(mergeValue(initialValue));
	const [savedValue, setSavedValue] = useState<AutomationFormValue>(() =>
		deserializeAutomationValue(initialValueSnapshot),
	);
	const [value, setValue] = useState<AutomationFormValue>(savedValue);
	const [scheduleOption, setScheduleOption] = useState<ScheduleOption>(() => inferScheduleOption(savedValue));
	const [promptError, setPromptError] = useState(false);
	const [emailRecipientsError, setEmailRecipientsError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isAutoSaving, setIsAutoSaving] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const promptRef = useRef<PromptHandle>(null);
	const autoSaveInFlightRef = useRef(false);
	const { data: session } = useSession();
	const availableModels = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const mcpState = useQuery(trpc.mcp.getState.queryOptions());
	const isDirty = !areAutomationValuesEqual(value, savedValue);
	const userEmail = session?.user?.email;
	const selectedModelValue =
		value.modelProvider && value.modelId ? `${value.modelProvider}:${value.modelId}` : defaultModelValue;
	const selectedModelName =
		availableModels.data?.find((model) => model.provider === value.modelProvider && model.modelId === value.modelId)
			?.name ?? value.modelId;
	const controlsDisabled = isPending || isAutoSaving;

	useEffect(() => {
		const nextValue = deserializeAutomationValue(initialValueSnapshot);
		setSavedValue(nextValue);
		setValue(nextValue);
		setScheduleOption(inferScheduleOption(nextValue));
		setPromptError(false);
		setEmailRecipientsError(null);
		setSubmitError(null);
	}, [initialValueSnapshot]);

	useEffect(() => {
		onDirtyChange?.(isDirty);
	}, [isDirty, onDirtyChange]);

	useEffect(() => {
		if (!saveShortcut) {
			return;
		}

		function handleKeyDown(event: KeyboardEvent) {
			const isSaveShortcut =
				event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
			if (!isSaveShortcut) {
				return;
			}

			event.preventDefault();
			if (!isDirty || controlsDisabled) {
				return;
			}
			formRef.current?.requestSubmit();
		}

		document.addEventListener('keydown', handleKeyDown, true);
		return () => document.removeEventListener('keydown', handleKeyDown, true);
	}, [controlsDisabled, isDirty, saveShortcut]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setSubmitError(null);
		if (!validateValueForSave(value, { focusPrompt: true })) {
			return;
		}

		try {
			await onSubmit(value);
			setSavedValue(value);
		} catch (error) {
			setSubmitError(getSubmitErrorMessage(error));
		}
	}

	function setTitle(title: string) {
		setValue({ ...value, title });
	}

	function setCustomCron(cron: string) {
		setValue({
			...value,
			cron,
			scheduleDescription: 'Custom schedule',
		});
	}

	function handleValueChange(nextValue: AutomationFormValue) {
		setSubmitError(null);
		setValue(nextValue);
	}

	function handlePromptChange(prompt: string) {
		setPromptError(false);
		handleValueChange({ ...value, prompt });
	}

	function handleControlValueChange(nextValue: AutomationFormValue) {
		handleValueChange(nextValue);
		if (autoSaveControls) {
			void autoSaveValue(nextValue);
		}
	}

	async function autoSaveValue(nextValue: AutomationFormValue) {
		if (autoSaveInFlightRef.current || !validateValueForSave(nextValue, { focusPrompt: false })) {
			return;
		}

		const previousSavedValue = savedValue;
		autoSaveInFlightRef.current = true;
		setIsAutoSaving(true);
		setSavedValue(nextValue);
		try {
			await onSubmit(nextValue);
			setSavedValue(nextValue);
		} catch (error) {
			setSavedValue(previousSavedValue);
			setSubmitError(getSubmitErrorMessage(error));
		} finally {
			autoSaveInFlightRef.current = false;
			setIsAutoSaving(false);
		}
	}

	function validateValueForSave(nextValue: AutomationFormValue, options: { focusPrompt: boolean }) {
		if (!nextValue.prompt.trim()) {
			setPromptError(true);
			if (options.focusPrompt) {
				promptRef.current?.focus();
			}
			return false;
		}

		const nextEmailRecipientsError = getEmailRecipientsError(nextValue.integrations.email);
		if (nextEmailRecipientsError) {
			setEmailRecipientsError(nextEmailRecipientsError);
			return false;
		}

		return true;
	}

	function clearEmailRecipientsError() {
		setEmailRecipientsError(null);
	}

	function handleInsertPromptTrigger(trigger: string) {
		promptRef.current?.insertText(trigger);
		requestAnimationFrame(() => promptRef.current?.focus());
	}

	function handleScheduleOptionChange(option: ScheduleOption) {
		setScheduleOption(option);
		if (option === 'custom') {
			handleControlValueChange({ ...value, scheduleDescription: 'Custom schedule' });
			return;
		}

		const preset = getSchedulePreset(option);
		handleControlValueChange({
			...value,
			cron: preset.cron,
			scheduleDescription: preset.description,
		});
	}

	function handleModelChange(modelValue: string) {
		if (modelValue === defaultModelValue) {
			handleControlValueChange({ ...value, modelProvider: undefined, modelId: undefined });
			return;
		}

		const model = availableModels.data?.find((item) => `${item.provider}:${item.modelId}` === modelValue);
		if (model) {
			handleControlValueChange({ ...value, modelProvider: model.provider, modelId: model.modelId });
		}
	}

	return {
		availableModels: availableModels.data,
		clearEmailRecipientsError,
		controlsDisabled,
		emailRecipientsError,
		formRef,
		handleControlValueChange,
		handleInsertPromptTrigger,
		handleModelChange,
		handlePromptChange,
		handleScheduleOptionChange,
		handleSubmit,
		handleValueChange,
		mcpState: mcpState.data,
		promptError,
		promptRef,
		scheduleOption,
		selectedModelName,
		selectedModelValue,
		setCustomCron,
		setTitle,
		submitError,
		userEmail,
		value,
	};
}

function AutomationDetailSummary({ details }: { details: AutomationDetails }) {
	return (
		<div className='grid gap-2 rounded-lg'>
			<DetailRow label='Status' value={details.enabled ? 'Enabled' : 'Paused'} />
			<DetailRow label='Next run' value={details.enabled ? formatDateTime(details.nextRunAt) : '-'} />
			<DetailRow label='Last run' value={formatDateTime(details.lastRunAt)} />
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className='flex items-center justify-between gap-3 text-sm'>
			<span className='text-muted-foreground'>{label}</span>
			<span className='text-right font-medium'>{value}</span>
		</div>
	);
}

function AutomationSidebarSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className='grid gap-4 rounded-xl border bg-background/60 p-4'>
			<h2 className='text-sm font-medium'>{title}</h2>
			<div className='grid'>{children}</div>
		</section>
	);
}

function AutomationPromptInput({
	promptRef,
	value,
	hasError,
	onChange,
}: {
	promptRef: RefObject<PromptHandle | null>;
	value: string;
	hasError: boolean;
	onChange: (value: string) => void;
}) {
	const lastPromptValueRef = useRef(value);

	useEffect(() => {
		const prompt = promptRef.current;
		if (!prompt || value === lastPromptValueRef.current) {
			return;
		}
		if (prompt.getValue() !== value) {
			prompt.clear();
			if (value) {
				prompt.insertText(value);
			}
		}
		lastPromptValueRef.current = value;
	}, [promptRef, value]);

	function handleChange(nextValue: string) {
		lastPromptValueRef.current = nextValue;
		onChange(nextValue);
	}

	return (
		<>
			<div
				aria-invalid={hasError}
				className={`border-input bg-card dark:bg-input/30 rounded-md border shadow-sm transition-[color,box-shadow,border-color] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] ${hasError ? 'border-destructive ring-1 ring-destructive/20 dark:ring-destructive/40' : ''}`}
			>
				<ChatPrompt
					promptRef={promptRef}
					initialValue={value}
					placeholder='Describe what the automation should do. Use mentions to add skills, story mode, or database context.'
					minHeight='12rem'
					onChange={handleChange}
				/>
			</div>
			{hasError && <p className='text-sm text-destructive'>Prompt is required.</p>}
		</>
	);
}

function PromptMentionHints({
	onInsertTrigger,
	email,
}: {
	onInsertTrigger: (trigger: string) => void;
	email?: string;
}) {
	return (
		<>
			<p className='flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground'>
				<span>Use</span>
				<PromptTriggerButton
					trigger={DATABASE_MENTION_TRIGGER}
					label='table context'
					onClick={onInsertTrigger}
				/>
				<span>for table context,</span>
				<PromptTriggerButton trigger={SKILL_MENTION_TRIGGER} label='skills' onClick={onInsertTrigger} />
				<span>for skills, or</span>
				<PromptTriggerButton trigger={MODE_MENTION_TRIGGER} label='modes' onClick={onInsertTrigger} />
				<span>for modes.</span>
			</p>
			<p className='text-xs text-muted-foreground'>
				The LLM knows your email address{email ? ` (${email})` : ''}, so you can say "send an email to me".
			</p>
		</>
	);
}

function PromptTriggerButton({
	trigger,
	label,
	onClick,
}: {
	trigger: string;
	label: string;
	onClick: (trigger: string) => void;
}) {
	return (
		<button
			type='button'
			aria-label={`Insert ${trigger} for ${label}`}
			onClick={() => onClick(trigger)}
			className='rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:bg-muted'
		>
			{trigger}
		</button>
	);
}

function IntegrationFields({
	value,
	mcpState,
	emailRecipientsError,
	onClearEmailRecipientsError,
	onChange,
	onAutoSaveChange,
	disabled,
}: {
	value: AutomationFormValue;
	mcpState: McpState | undefined;
	emailRecipientsError: string | null;
	onClearEmailRecipientsError: () => void;
	onChange: (value: AutomationFormValue) => void;
	onAutoSaveChange: (value: AutomationFormValue) => void;
	disabled: boolean;
}) {
	const email = value.integrations.email ?? { enabled: false, recipients: [] };
	const slack = value.integrations.slack ?? { enabled: false, channelId: '' };
	const github = value.integrations.github ?? { enabled: false, repositories: [] };
	const mcpServers = mcpState ? Object.entries(mcpState) : [];
	const selectedMcpServers = value.mcpServers ?? mcpServers.map(([serverName]) => serverName);
	const githubIntegration = useGithubIntegration({
		github,
		value,
		onAutoSaveChange,
	});

	return (
		<div className='grid gap-4'>
			<div className='grid gap-3'>
				<ToggleRow
					label='Email'
					description='Allow the agent to send emails.'
					checked={email.enabled}
					onCheckedChange={(enabled) => {
						onClearEmailRecipientsError();
						onAutoSaveChange({
							...value,
							integrations: { ...value.integrations, email: { ...email, enabled } },
						});
					}}
					disabled={disabled}
				/>
				{email.enabled && (
					<div className='grid gap-2 pl-4'>
						<Input
							placeholder='Additional recipients, comma separated'
							value={email.recipients.join(', ')}
							aria-invalid={Boolean(emailRecipientsError)}
							aria-describedby={emailRecipientsError ? 'automation-email-recipients-error' : undefined}
							onChange={(event) => {
								onClearEmailRecipientsError();
								onChange({
									...value,
									integrations: {
										...value.integrations,
										email: { ...email, recipients: splitCommaList(event.target.value) },
									},
								});
							}}
						/>
						{emailRecipientsError && (
							<p id='automation-email-recipients-error' className='text-xs text-destructive'>
								{emailRecipientsError}
							</p>
						)}
						<Input
							placeholder='Override subject'
							value={email.subject ?? ''}
							onChange={(event) =>
								onChange({
									...value,
									integrations: {
										...value.integrations,
										email: { ...email, subject: event.target.value },
									},
								})
							}
						/>
					</div>
				)}
			</div>

			<div className='grid gap-3'>
				<ToggleRow
					label='Slack'
					description='Post proactive messages to a Slack channel ID.'
					checked={slack.enabled}
					onCheckedChange={(enabled) =>
						onAutoSaveChange({
							...value,
							integrations: { ...value.integrations, slack: { ...slack, enabled } },
						})
					}
					disabled={disabled}
				/>
				{slack.enabled && (
					<Input
						className='ml-4 w-[calc(100%-1rem)]'
						placeholder='Slack channel ID, for example C0123456789'
						value={slack.channelId}
						onChange={(event) =>
							onChange({
								...value,
								integrations: {
									...value.integrations,
									slack: { ...slack, channelId: event.target.value },
								},
							})
						}
					/>
				)}
			</div>

			<div className='grid gap-3'>
				<ToggleRow
					label='GitHub'
					description={githubIntegration.description}
					checked={github.enabled}
					onCheckedChange={githubIntegration.onEnabledChange}
					disabled={disabled || (!github.enabled && !githubIntegration.canEnable)}
				/>
				{github.enabled && (
					<Input
						className='ml-4 w-[calc(100%-1rem)]'
						placeholder='Allowed repos, comma separated. Leave empty to allow all connected repos.'
						value={github.repositories.join(', ')}
						onChange={(event) =>
							onChange({
								...value,
								integrations: {
									...value.integrations,
									github: { ...github, repositories: splitCommaList(event.target.value) },
								},
							})
						}
					/>
				)}
			</div>

			<div className='grid gap-3'>
				<ToggleRow
					label='MCP'
					description='Allow selected MCP servers during this automation run.'
					checked={value.mcpEnabled}
					onCheckedChange={(mcpEnabled) => onAutoSaveChange({ ...value, mcpEnabled })}
					disabled={disabled}
				/>
				{value.mcpEnabled && (
					<div className='grid gap-2 pl-4'>
						{mcpState === undefined && (
							<p className='text-xs text-muted-foreground'>Loading MCP servers...</p>
						)}
						{mcpState && mcpServers.length === 0 && (
							<p className='text-xs text-muted-foreground'>No MCP servers connected.</p>
						)}
						{mcpServers.map(([serverName, server]) => {
							const enabledToolCount = server.tools.filter((tool) => tool.enabled).length;
							const isSelected = selectedMcpServers.includes(serverName);

							return (
								<ToggleRow
									key={serverName}
									label={serverName}
									description={
										server.error
											? 'Connection error'
											: `${enabledToolCount} enabled ${enabledToolCount === 1 ? 'tool' : 'tools'}`
									}
									checked={isSelected}
									onCheckedChange={(checked) =>
										onAutoSaveChange({
											...value,
											mcpServers: checked
												? [...new Set([...selectedMcpServers, serverName])]
												: selectedMcpServers.filter((name) => name !== serverName),
										})
									}
									disabled={disabled}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function ToggleRow({
	label,
	description,
	checked,
	onCheckedChange,
	disabled,
}: {
	label: string;
	description: ReactNode;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div className='flex items-center justify-between gap-4'>
			<div>
				<div className='text-sm font-medium'>{label}</div>
				<div className='text-xs text-muted-foreground'>{description}</div>
			</div>
			<Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
		</div>
	);
}

function useGithubIntegration({
	github,
	value,
	onAutoSaveChange,
}: {
	github: NonNullable<IntegrationConfig['github']>;
	value: AutomationFormValue;
	onAutoSaveChange: (value: AutomationFormValue) => void;
}) {
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const githubStatusData = githubStatus.data;
	const connectedGithubLogin = githubStatusData?.connected === true ? githubStatusData.user.login : undefined;
	const canEnable = githubAvailable.data === true && Boolean(connectedGithubLogin);
	const description = getGithubIntegrationDescription({
		available: githubAvailable.data,
		connectedLogin: connectedGithubLogin,
		checkingConnection: githubAvailable.data === true && githubStatusData === undefined,
		connectHref: getGithubConnectHref(),
	});

	function handleEnabledChange(enabled: boolean) {
		if (enabled && !canEnable) {
			return;
		}

		onAutoSaveChange({
			...value,
			integrations: { ...value.integrations, github: { ...github, enabled } },
		});
	}

	return {
		canEnable,
		description,
		onEnabledChange: handleEnabledChange,
	};
}

function getGithubIntegrationDescription({
	available,
	connectedLogin,
	checkingConnection,
	connectHref,
}: {
	available: boolean | undefined;
	connectedLogin?: string;
	checkingConnection: boolean;
	connectHref: string;
}): ReactNode {
	if (connectedLogin) {
		return (
			<>
				Allow the agent to create issues, open pull requests, or comment on issues/PRs as{' '}
				<span className='font-medium text-foreground'>@{connectedLogin}</span>.
			</>
		);
	}

	if (available === false) {
		return 'GitHub integration is not configured for this workspace.';
	}

	if (available === undefined || checkingConnection) {
		return 'Checking GitHub connection...';
	}

	return (
		<>
			Allow the agent to create issues, open pull requests, or comment on issues/PRs.{' '}
			<a href={connectHref} className='font-medium text-primary underline underline-offset-2'>
				Connect
			</a>{' '}
			GitHub to enable it.
		</>
	);
}

function getGithubConnectHref(): string {
	return `/api/github/connect?returnTo=${encodeURIComponent('/settings/account')}`;
}

function formatDateTime(value: Date | string | null | undefined): string {
	if (!value) {
		return '-';
	}
	return new Date(value).toLocaleString();
}

function mergeValue(value: Partial<AutomationFormValue> | undefined): AutomationFormValue {
	return {
		...defaultValue,
		...value,
		integrations: {
			...defaultValue.integrations,
			...value?.integrations,
		},
	};
}

function getScheduleOption(cron: string): ScheduleOption {
	return schedulePresets.find((preset) => preset.cron === cron)?.value ?? 'custom';
}

function inferScheduleOption(value: AutomationFormValue): ScheduleOption {
	return value.scheduleDescription === 'Custom schedule' ? 'custom' : getScheduleOption(value.cron);
}

function getSchedulePreset(value: Exclude<ScheduleOption, 'custom'>): SchedulePreset {
	return schedulePresets.find((preset) => preset.value === value) ?? schedulePresets[0];
}

function areAutomationValuesEqual(left: AutomationFormValue, right: AutomationFormValue): boolean {
	return serializeAutomationValue(left) === serializeAutomationValue(right);
}

function serializeAutomationValue(value: AutomationFormValue): string {
	return JSON.stringify(normalizeAutomationValue(value));
}

function deserializeAutomationValue(value: string): AutomationFormValue {
	return JSON.parse(value) as AutomationFormValue;
}

function normalizeAutomationValue(value: AutomationFormValue): AutomationFormValue {
	return {
		...value,
		scheduleDescription: value.scheduleDescription ?? '',
		mcpServers: value.mcpServers ? [...value.mcpServers].sort() : undefined,
		integrations: {
			email: value.integrations.email
				? {
						enabled: value.integrations.email.enabled,
						recipients: value.integrations.email.recipients,
						subject: value.integrations.email.subject ?? '',
					}
				: undefined,
			slack: value.integrations.slack
				? {
						enabled: value.integrations.slack.enabled,
						channelId: value.integrations.slack.channelId,
					}
				: undefined,
			github: value.integrations.github
				? {
						enabled: value.integrations.github.enabled,
						repositories: value.integrations.github.repositories,
					}
				: undefined,
		},
	};
}

function splitCommaList(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function getEmailRecipientsError(email: IntegrationConfig['email']): string | null {
	if (!email?.enabled) {
		return null;
	}
	const invalidRecipients = email.recipients.filter((recipient) => !isValidEmailAddress(recipient));
	if (invalidRecipients.length === 0) {
		return null;
	}
	return `Enter valid email recipients: ${invalidRecipients.join(', ')}.`;
}

function isValidEmailAddress(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getSubmitErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || !error.message) {
		return 'Failed to save automation.';
	}
	return parseValidationErrorMessage(error.message) ?? error.message;
}

function parseValidationErrorMessage(message: string): string | null {
	try {
		const parsed: unknown = JSON.parse(message);
		if (!Array.isArray(parsed)) {
			return null;
		}
		const messages = parsed
			.map((item) => (isValidationIssue(item) ? item.message : null))
			.filter((item): item is string => Boolean(item));
		return messages.length > 0 ? [...new Set(messages)].join(' ') : null;
	} catch {
		return null;
	}
}

function isValidationIssue(value: unknown): value is { message: string } {
	return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}
