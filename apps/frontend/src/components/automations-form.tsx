import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Github, Mail, Plus, Trash2, X } from 'lucide-react';
import type { McpState } from '@nao/shared';
import type { LlmProvider } from '@nao/shared/types';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type { PromptHandle } from 'prompt-mentions';
import McpIcon from '@/components/icons/model-context-protocol.svg';
import SlackIcon from '@/components/icons/slack.svg';
import { ChatPrompt, DATABASE_MENTION_TRIGGER, SKILL_MENTION_TRIGGER } from '@/components/chat-input-prompt';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
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
		actions?: GithubActionsConfig;
	};
};

type GithubActionsConfig = {
	createIssue?: boolean;
	createPullRequest?: boolean;
	addComment?: boolean;
};

type GithubActionKey = keyof GithubActionsConfig;

type GithubMenuItemKey = 'read' | GithubActionKey;

const GITHUB_MENU_ITEMS: Array<{ key: GithubMenuItemKey; label: string; description: string }> = [
	{
		key: 'read',
		label: 'Read repos',
		description: 'Inspect issues, PRs, comments, and files. Always included.',
	},
	{
		key: 'createIssue',
		label: 'Create issues',
		description: 'Open new GitHub issues with a title, body, and optional labels.',
	},
	{
		key: 'createPullRequest',
		label: 'Open pull requests',
		description: 'Open a PR between two existing branches.',
	},
	{
		key: 'addComment',
		label: 'Comment on issues/PRs',
		description: 'Post markdown comments on existing issues or PRs.',
	},
];

const GITHUB_ACTION_LABELS: Record<GithubMenuItemKey, string> = Object.fromEntries(
	GITHUB_MENU_ITEMS.map((item) => [item.key, item.label]),
) as Record<GithubMenuItemKey, string>;

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

type AvailableModel = {
	provider: LlmProvider;
	modelId: string;
	name: string;
};

const defaultModelValue = 'default';
const MODE_MENTION_TRIGGER = '#';
const DEFAULT_SCHEDULE_CRON = '0 9 * * 1';
const DEFAULT_SCHEDULE_DESCRIPTION = 'Every Monday at 9am';
const CUSTOM_SCHEDULE_DESCRIPTION = 'Custom schedule';

const defaultValue: AutomationFormValue = {
	title: '',
	prompt: '',
	cron: '',
	scheduleDescription: undefined,
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
	{ value: 'weekly', label: 'Weekly', cron: DEFAULT_SCHEDULE_CRON, description: DEFAULT_SCHEDULE_DESCRIPTION },
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

	const hasSidebar = Boolean(details || aside);

	return (
		<form
			ref={form.formRef}
			id={id}
			onSubmit={form.handleSubmit}
			className={cn(
				'grid gap-6',
				hasSidebar && 'xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]',
			)}
		>
			<div className='grid content-start gap-6'>
				<AutomationTitleField
					value={form.value.title}
					onChange={form.setTitle}
					placeholder={form.titlePlaceholder}
				/>

				<TriggersSection
					cron={form.value.cron}
					hasSchedule={form.hasSchedule}
					scheduleOption={form.scheduleOption}
					onScheduleOptionChange={form.handleScheduleOptionChange}
					onCustomCronChange={form.setCustomCron}
					onAddSchedule={form.handleAddSchedule}
					onRemoveSchedule={form.handleRemoveSchedule}
					hasError={form.triggerError}
					disabled={form.controlsDisabled}
				/>

				<AgentInstructionsSection
					promptRef={form.promptRef}
					promptValue={form.value.prompt}
					promptHasError={form.promptError}
					onPromptChange={form.handlePromptChange}
					modelValue={form.selectedModelValue}
					modelName={form.selectedModelName}
					modelProvider={form.value.modelProvider}
					availableModels={form.availableModels}
					onModelChange={form.handleModelChange}
					modelDisabled={form.controlsDisabled}
					email={form.userEmail}
					onInsertPromptTrigger={form.handleInsertPromptTrigger}
				/>

				<ToolsSection
					value={form.value}
					mcpState={form.mcpState}
					emailRecipientsError={form.emailRecipientsError}
					onClearEmailRecipientsError={form.clearEmailRecipientsError}
					onChange={form.handleValueChange}
					onAutoSaveChange={form.handleControlValueChange}
					disabled={form.controlsDisabled}
				/>

				{!hasSidebar && form.submitError && <ErrorMessage message={form.submitError} />}
				{!hasSidebar && showSubmitButton && (
					<Button
						type='submit'
						variant='primary-gradient'
						disabled={isPending}
						className='justify-self-start'
					>
						{isPending ? 'Saving...' : submitLabel}
					</Button>
				)}
			</div>

			{hasSidebar && (
				<div className='grid content-start gap-4'>
					{details && (
						<AutomationSidebarSection title='Details'>
							<AutomationDetailSummary details={details} />
						</AutomationSidebarSection>
					)}

					{aside}

					{form.submitError && <ErrorMessage message={form.submitError} />}

					{showSubmitButton && (
						<Button type='submit' variant='primary-gradient' disabled={isPending} className='w-full'>
							{isPending ? 'Saving...' : submitLabel}
						</Button>
					)}
				</div>
			)}
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
	const [hasSchedule, setHasSchedule] = useState<boolean>(() => savedValue.cron.trim().length > 0);
	const [promptError, setPromptError] = useState(false);
	const [triggerError, setTriggerError] = useState(false);
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
	const titlePlaceholder =
		value.prompt.trim().length > 0 ? 'A title will be generated from your prompt' : 'Untitled automation';

	useEffect(() => {
		const nextValue = deserializeAutomationValue(initialValueSnapshot);
		setSavedValue(nextValue);
		setValue(nextValue);
		setScheduleOption(inferScheduleOption(nextValue));
		setHasSchedule(nextValue.cron.trim().length > 0);
		setPromptError(false);
		setTriggerError(false);
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
			scheduleDescription: CUSTOM_SCHEDULE_DESCRIPTION,
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

		if (!nextValue.cron.trim()) {
			setTriggerError(true);
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

	function handleAddSchedule() {
		setTriggerError(false);
		setScheduleOption('weekly');
		setHasSchedule(true);
		handleControlValueChange({
			...value,
			cron: DEFAULT_SCHEDULE_CRON,
			scheduleDescription: DEFAULT_SCHEDULE_DESCRIPTION,
		});
	}

	function handleRemoveSchedule() {
		setScheduleOption('custom');
		setHasSchedule(false);
		handleControlValueChange({
			...value,
			cron: '',
			scheduleDescription: undefined,
		});
	}

	function handleScheduleOptionChange(option: ScheduleOption) {
		setTriggerError(false);
		setScheduleOption(option);
		if (option === 'custom') {
			handleControlValueChange({ ...value, scheduleDescription: CUSTOM_SCHEDULE_DESCRIPTION });
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
		handleAddSchedule,
		handleControlValueChange,
		handleInsertPromptTrigger,
		handleModelChange,
		handlePromptChange,
		handleRemoveSchedule,
		handleScheduleOptionChange,
		handleSubmit,
		handleValueChange,
		hasSchedule,
		mcpState: mcpState.data,
		promptError,
		promptRef,
		scheduleOption,
		selectedModelName,
		selectedModelValue,
		setCustomCron,
		setTitle,
		submitError,
		titlePlaceholder,
		triggerError,
		userEmail,
		value,
	};
}

function AutomationTitleField({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	return (
		<input
			type='text'
			value={value}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			aria-label='Automation title'
			className='w-full border-none bg-transparent px-0 text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 focus:outline-none'
		/>
	);
}

function TriggersSection({
	cron,
	hasSchedule,
	scheduleOption,
	onScheduleOptionChange,
	onCustomCronChange,
	onAddSchedule,
	onRemoveSchedule,
	hasError,
	disabled,
}: {
	cron: string;
	hasSchedule: boolean;
	scheduleOption: ScheduleOption;
	onScheduleOptionChange: (option: ScheduleOption) => void;
	onCustomCronChange: (cron: string) => void;
	onAddSchedule: () => void;
	onRemoveSchedule: () => void;
	hasError: boolean;
	disabled: boolean;
}) {
	return (
		<section className='grid gap-1.5'>
			<label className='text-sm font-medium'>Triggers</label>
			<div
				className={cn(
					'grid gap-1 rounded-xl border bg-background/60 p-1',
					hasError && 'border-destructive ring-1 ring-destructive/20',
				)}
			>
				{hasSchedule && (
					<ScheduleTriggerRow
						cron={cron}
						scheduleOption={scheduleOption}
						onScheduleOptionChange={onScheduleOptionChange}
						onCustomCronChange={onCustomCronChange}
						onRemove={onRemoveSchedule}
						disabled={disabled}
					/>
				)}
				{!hasSchedule && <AddTriggerMenu onAddSchedule={onAddSchedule} disabled={disabled} />}
			</div>
			{hasError && <p className='text-sm text-destructive'>Add at least one trigger.</p>}
		</section>
	);
}

function ScheduleTriggerRow({
	cron,
	scheduleOption,
	onScheduleOptionChange,
	onCustomCronChange,
	onRemove,
	disabled,
}: {
	cron: string;
	scheduleOption: ScheduleOption;
	onScheduleOptionChange: (option: ScheduleOption) => void;
	onCustomCronChange: (cron: string) => void;
	onRemove: () => void;
	disabled: boolean;
}) {
	return (
		<div className='grid gap-1.5 rounded-lg px-2 py-1.5'>
			<div className='flex items-center justify-between gap-3'>
				<div className='flex min-w-0 items-center gap-2'>
					<Calendar className='size-4 shrink-0 text-muted-foreground' />
					<span className='text-sm font-medium'>On schedule</span>
				</div>
				<div className='flex items-center gap-1'>
					<Select
						value={scheduleOption}
						onValueChange={(option) => onScheduleOptionChange(option as ScheduleOption)}
						disabled={disabled}
					>
						<SelectTrigger
							variant='ghost'
							size='sm'
							className='min-w-0 max-w-40 justify-end px-2 text-right'
						>
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
					<button
						type='button'
						onClick={onRemove}
						disabled={disabled}
						aria-label='Remove schedule trigger'
						className='inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
					>
						<Trash2 className='size-3.5' />
					</button>
				</div>
			</div>

			{scheduleOption === 'custom' && (
				<Input
					value={cron}
					onChange={(event) => onCustomCronChange(event.target.value)}
					placeholder='0 9 * * 1'
					className='h-8'
				/>
			)}
		</div>
	);
}

function AddTriggerMenu({ onAddSchedule, disabled }: { onAddSchedule: () => void; disabled: boolean }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					disabled={disabled}
					className='inline-flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50'
				>
					<Plus className='size-4' />
					<span>Add Trigger</span>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='min-w-56'>
				<DropdownMenuItem onSelect={onAddSchedule}>
					<Calendar className='size-4' />
					<span>On schedule</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function AgentInstructionsSection({
	promptRef,
	promptValue,
	promptHasError,
	onPromptChange,
	modelValue,
	modelName,
	modelProvider,
	availableModels,
	onModelChange,
	modelDisabled,
	email,
	onInsertPromptTrigger,
}: {
	promptRef: RefObject<PromptHandle | null>;
	promptValue: string;
	promptHasError: boolean;
	onPromptChange: (value: string) => void;
	modelValue: string;
	modelName: string | undefined;
	modelProvider: LlmProvider | undefined;
	availableModels: AvailableModel[] | undefined;
	onModelChange: (modelValue: string) => void;
	modelDisabled: boolean;
	email?: string;
	onInsertPromptTrigger: (trigger: string) => void;
}) {
	return (
		<section className='grid gap-2'>
			<label className='text-sm font-medium'>Agent instructions</label>
			<AutomationPromptInput
				promptRef={promptRef}
				value={promptValue}
				hasError={promptHasError}
				onChange={onPromptChange}
				footer={
					<AutomationModelSelect
						value={modelValue}
						modelName={modelName}
						provider={modelProvider}
						availableModels={availableModels}
						onChange={onModelChange}
						disabled={modelDisabled}
					/>
				}
			/>
			<PromptMentionHints email={email} onInsertTrigger={onInsertPromptTrigger} />
		</section>
	);
}

function AutomationPromptInput({
	promptRef,
	value,
	hasError,
	onChange,
	footer,
}: {
	promptRef: RefObject<PromptHandle | null>;
	value: string;
	hasError: boolean;
	onChange: (value: string) => void;
	footer?: ReactNode;
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
				className={cn(
					'rounded-xl border bg-background/60',
					hasError && 'border-destructive ring-1 ring-destructive/20',
				)}
			>
				<ChatPrompt
					promptRef={promptRef}
					initialValue={value}
					placeholder='Type @ for tools, / for commands...'
					minHeight='10rem'
					onChange={handleChange}
				/>
				{footer && <div className='flex items-center justify-between gap-2 px-3 pb-2.5'>{footer}</div>}
			</div>
			{hasError && <p className='text-sm text-destructive'>Prompt is required.</p>}
		</>
	);
}

function AutomationModelSelect({
	value,
	modelName,
	provider,
	availableModels,
	onChange,
	disabled,
}: {
	value: string;
	modelName: string | undefined;
	provider: LlmProvider | undefined;
	availableModels: AvailableModel[] | undefined;
	onChange: (modelValue: string) => void;
	disabled: boolean;
}) {
	return (
		<Select value={value} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger
				variant='ghost'
				size='sm'
				className='h-7 min-w-0 max-w-48 gap-1.5 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground'
			>
				<SelectValue>
					<div className='flex min-w-0 items-center gap-1.5'>
						{provider && <LlmProviderIcon provider={provider} className='size-3.5' />}
						<span className='truncate'>{modelName ?? 'Default model'}</span>
					</div>
				</SelectValue>
			</SelectTrigger>
			<SelectContent align='start'>
				<SelectItem value={defaultModelValue}>Default model</SelectItem>
				{availableModels?.map((model) => (
					<SelectItem key={`${model.provider}-${model.modelId}`} value={`${model.provider}:${model.modelId}`}>
						<LlmProviderIcon provider={model.provider} className='size-4' />
						{model.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
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

function ToolsSection({
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
	const mcpServerEntries = mcpState ? Object.entries(mcpState) : [];
	const selectedMcpServers = value.mcpEnabled ? (value.mcpServers ?? mcpServerEntries.map(([name]) => name)) : [];

	const githubIntegration = useGithubIntegration({ github, value, onAutoSaveChange });

	const addedTools: AddedTool[] = [];
	if (email.enabled) {
		addedTools.push({ key: 'email', kind: 'integration', type: 'email' });
	}
	if (slack.enabled) {
		addedTools.push({ key: 'slack', kind: 'integration', type: 'slack' });
	}
	if (github.enabled) {
		addedTools.push({ key: 'github', kind: 'integration', type: 'github' });
	}
	if (value.mcpEnabled) {
		for (const [serverName] of mcpServerEntries) {
			if (selectedMcpServers.includes(serverName)) {
				addedTools.push({ key: `mcp:${serverName}`, kind: 'mcp', serverName });
			}
		}
	}

	function setEmailEnabled(enabled: boolean) {
		onClearEmailRecipientsError();
		onAutoSaveChange({
			...value,
			integrations: { ...value.integrations, email: { ...email, enabled } },
		});
	}

	function setSlackEnabled(enabled: boolean) {
		onAutoSaveChange({
			...value,
			integrations: { ...value.integrations, slack: { ...slack, enabled } },
		});
	}

	function addMcpServer(serverName: string) {
		const nextServers = [...new Set([...selectedMcpServers, serverName])];
		onAutoSaveChange({ ...value, mcpEnabled: true, mcpServers: nextServers });
	}

	function removeMcpServer(serverName: string) {
		const nextServers = selectedMcpServers.filter((name) => name !== serverName);
		onAutoSaveChange({
			...value,
			mcpEnabled: nextServers.length > 0,
			mcpServers: nextServers,
		});
	}

	return (
		<section className='grid gap-1.5'>
			<label className='text-sm font-medium'>Tools</label>
			<div className='grid gap-1 rounded-xl border bg-background/60 p-1'>
				{addedTools.map((tool) => (
					<ToolRow
						key={tool.key}
						tool={tool}
						value={value}
						emailRecipientsError={emailRecipientsError}
						onClearEmailRecipientsError={onClearEmailRecipientsError}
						onChange={onChange}
						onRemoveEmail={() => setEmailEnabled(false)}
						onRemoveSlack={() => setSlackEnabled(false)}
						onRemoveGithub={() => githubIntegration.onEnabledChange(false)}
						onRemoveGithubAction={githubIntegration.onRemoveAction}
						onRemoveMcpServer={removeMcpServer}
						githubDescription={githubIntegration.description}
						githubActiveItems={githubIntegration.activeItems}
						disabled={disabled}
					/>
				))}
				<AddToolMenu
					emailEnabled={email.enabled}
					slackEnabled={slack.enabled}
					githubState={githubIntegration.state}
					githubActiveItems={githubIntegration.activeItems}
					mcpServerEntries={mcpServerEntries}
					selectedMcpServers={selectedMcpServers}
					onAddEmail={() => setEmailEnabled(true)}
					onAddSlack={() => setSlackEnabled(true)}
					onAddGithubItem={githubIntegration.onAddItem}
					onAddMcpServer={addMcpServer}
					disabled={disabled}
				/>
			</div>
		</section>
	);
}

type AddedTool =
	| { key: string; kind: 'integration'; type: 'email' | 'slack' | 'github' }
	| { key: string; kind: 'mcp'; serverName: string };

function ToolRow({
	tool,
	value,
	emailRecipientsError,
	onClearEmailRecipientsError,
	onChange,
	onRemoveEmail,
	onRemoveSlack,
	onRemoveGithub,
	onRemoveGithubAction,
	onRemoveMcpServer,
	githubDescription,
	githubActiveItems,
	disabled,
}: {
	tool: AddedTool;
	value: AutomationFormValue;
	emailRecipientsError: string | null;
	onClearEmailRecipientsError: () => void;
	onChange: (value: AutomationFormValue) => void;
	onRemoveEmail: () => void;
	onRemoveSlack: () => void;
	onRemoveGithub: () => void;
	onRemoveGithubAction: (key: GithubActionKey) => void;
	onRemoveMcpServer: (serverName: string) => void;
	githubDescription: ReactNode;
	githubActiveItems: GithubMenuItemKey[];
	disabled: boolean;
}) {
	if (tool.kind === 'mcp') {
		return (
			<ToolRowShell
				icon={<McpIcon className='size-4' />}
				title={tool.serverName}
				onRemove={() => onRemoveMcpServer(tool.serverName)}
				disabled={disabled}
			/>
		);
	}

	if (tool.type === 'email') {
		const email = value.integrations.email ?? { enabled: false, recipients: [] };
		return (
			<ToolRowShell
				icon={<Mail className='size-4 text-muted-foreground' />}
				title='Email'
				onRemove={onRemoveEmail}
				disabled={disabled}
			>
				<div className='grid gap-1.5'>
					<Input
						className='h-8'
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
						className='h-8'
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
			</ToolRowShell>
		);
	}

	if (tool.type === 'slack') {
		const slack = value.integrations.slack ?? { enabled: false, channelId: '' };
		return (
			<ToolRowShell
				icon={<SlackIcon className='size-4' />}
				title='Slack'
				onRemove={onRemoveSlack}
				disabled={disabled}
			>
				<Input
					className='h-8'
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
			</ToolRowShell>
		);
	}

	const github = value.integrations.github ?? { enabled: false, repositories: [] };

	return (
		<ToolRowShell
			icon={<Github className='size-4 text-muted-foreground' />}
			title='GitHub'
			description={githubDescription}
			onRemove={onRemoveGithub}
			disabled={disabled}
		>
			<div className='grid gap-2'>
				<Input
					className='h-8'
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
				<GithubActiveItemsList items={githubActiveItems} onRemove={onRemoveGithubAction} disabled={disabled} />
			</div>
		</ToolRowShell>
	);
}

function GithubActiveItemsList({
	items,
	onRemove,
	disabled,
}: {
	items: GithubMenuItemKey[];
	onRemove: (key: GithubActionKey) => void;
	disabled: boolean;
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<div className='flex flex-wrap items-center gap-1'>
			{items.map((key) => {
				const isRead = key === 'read';
				return (
					<span
						key={key}
						className='inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs text-foreground'
					>
						<span>{GITHUB_ACTION_LABELS[key]}</span>
						{!isRead && (
							<button
								type='button'
								onClick={() => onRemove(key)}
								disabled={disabled}
								aria-label={`Remove ${GITHUB_ACTION_LABELS[key]}`}
								className='inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
							>
								<X className='size-3' />
							</button>
						)}
					</span>
				);
			})}
		</div>
	);
}

function ToolRowShell({
	icon,
	title,
	description,
	onRemove,
	disabled,
	children,
}: {
	icon: ReactNode;
	title: string;
	description?: ReactNode;
	onRemove: () => void;
	disabled: boolean;
	children?: ReactNode;
}) {
	return (
		<div className='grid gap-1 rounded-lg px-2 py-1.5'>
			<div className='flex items-center justify-between gap-3'>
				<div className='flex min-w-0 items-center gap-2'>
					{icon}
					<span className='truncate text-sm font-medium'>{title}</span>
				</div>
				<button
					type='button'
					onClick={onRemove}
					disabled={disabled}
					aria-label={`Remove ${title}`}
					className='inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
				>
					<Trash2 className='size-3.5' />
				</button>
			</div>
			{description && <div className='text-xs text-muted-foreground'>{description}</div>}
			{children}
		</div>
	);
}

function AddToolMenu({
	emailEnabled,
	slackEnabled,
	githubState,
	githubActiveItems,
	mcpServerEntries,
	selectedMcpServers,
	onAddEmail,
	onAddSlack,
	onAddGithubItem,
	onAddMcpServer,
	disabled,
}: {
	emailEnabled: boolean;
	slackEnabled: boolean;
	githubState: GithubMenuState;
	githubActiveItems: GithubMenuItemKey[];
	mcpServerEntries: [string, McpState[string]][];
	selectedMcpServers: string[];
	onAddEmail: () => void;
	onAddSlack: () => void;
	onAddGithubItem: (key: GithubMenuItemKey) => void;
	onAddMcpServer: (serverName: string) => void;
	disabled: boolean;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					disabled={disabled}
					className='inline-flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50'
				>
					<Plus className='size-4' />
					<span>Add Tool or MCP</span>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='min-w-56'>
				<DropdownMenuLabel>Messaging</DropdownMenuLabel>
				<DropdownMenuItem onSelect={onAddEmail} disabled={emailEnabled}>
					<Mail className='size-4' />
					<span>Email</span>
					{emailEnabled && <span className='ml-auto text-xs text-muted-foreground'>Added</span>}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onAddSlack} disabled={slackEnabled}>
					<SlackIcon className='size-4' />
					<span>Slack</span>
					{slackEnabled && <span className='ml-auto text-xs text-muted-foreground'>Added</span>}
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuLabel>Code</DropdownMenuLabel>
				<GithubSubMenu state={githubState} activeItems={githubActiveItems} onAddItem={onAddGithubItem} />

				<DropdownMenuSeparator />
				<DropdownMenuLabel>MCP</DropdownMenuLabel>
				<McpSubMenu
					mcpServerEntries={mcpServerEntries}
					selectedMcpServers={selectedMcpServers}
					onAddMcpServer={onAddMcpServer}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function GithubSubMenu({
	state,
	activeItems,
	onAddItem,
}: {
	state: GithubMenuState;
	activeItems: GithubMenuItemKey[];
	onAddItem: (key: GithubMenuItemKey) => void;
}) {
	if (state !== 'ready') {
		return (
			<DropdownMenuItem onSelect={() => onAddItem('read')} disabled={state !== 'needs-connect'}>
				<Github className='size-4' />
				<span>GitHub</span>
				<GithubMenuItemBadge state={state} />
			</DropdownMenuItem>
		);
	}

	const activeSet = new Set(activeItems);
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<Github className='size-4' />
				<span>GitHub</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className='min-w-64'>
				{GITHUB_MENU_ITEMS.map((item) => {
					const isAdded = activeSet.has(item.key);
					return (
						<DropdownMenuItem key={item.key} onSelect={() => onAddItem(item.key)} disabled={isAdded}>
							<div className='grid gap-0.5'>
								<span>{item.label}</span>
								<span className='text-xs text-muted-foreground'>{item.description}</span>
							</div>
							{isAdded && <span className='ml-auto text-xs text-muted-foreground'>Added</span>}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function GithubMenuItemBadge({ state }: { state: GithubMenuState }) {
	if (state === 'unconfigured') {
		return <span className='ml-auto text-xs text-muted-foreground'>Not configured</span>;
	}
	if (state === 'loading') {
		return <span className='ml-auto text-xs text-muted-foreground'>Checking...</span>;
	}
	if (state === 'needs-connect') {
		return <span className='ml-auto text-xs text-primary'>Connect</span>;
	}
	return null;
}

function McpSubMenu({
	mcpServerEntries,
	selectedMcpServers,
	onAddMcpServer,
}: {
	mcpServerEntries: [string, McpState[string]][];
	selectedMcpServers: string[];
	onAddMcpServer: (serverName: string) => void;
}) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<McpIcon className='size-4' />
				<span>MCP server</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className='min-w-56'>
				{mcpServerEntries.length === 0 && (
					<DropdownMenuItem disabled>
						<span className='text-xs text-muted-foreground'>No MCP servers connected</span>
					</DropdownMenuItem>
				)}
				{mcpServerEntries.map(([name, server]) => {
					const isAdded = selectedMcpServers.includes(name);
					const enabledToolCount = server.tools.filter((tool) => tool.enabled).length;
					return (
						<DropdownMenuItem key={name} onSelect={() => onAddMcpServer(name)} disabled={isAdded}>
							<McpIcon className='size-4' />
							<span className='truncate'>{name}</span>
							<span className='ml-auto text-xs text-muted-foreground'>
								{isAdded
									? 'Added'
									: server.error
										? 'Error'
										: `${enabledToolCount} ${enabledToolCount === 1 ? 'tool' : 'tools'}`}
							</span>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
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

export type GithubMenuState = 'loading' | 'unconfigured' | 'needs-connect' | 'ready';

function useGithubIntegration({
	github,
	value,
	onAutoSaveChange,
}: {
	github: NonNullable<IntegrationConfig['github']>;
	value: AutomationFormValue;
	onAutoSaveChange: (value: AutomationFormValue) => void;
}) {
	const navigate = useNavigate();
	const githubAvailable = useQuery(trpc.github.isAvailable.queryOptions());
	const githubStatus = useQuery({
		...trpc.github.getStatus.queryOptions(),
		enabled: githubAvailable.data === true,
	});
	const connectedGithubLogin = githubStatus.data?.connected === true ? githubStatus.data.user.login : undefined;
	const state = resolveGithubMenuState(githubAvailable.data, githubStatus.data);
	const description = getGithubIntegrationDescription({
		state,
		connectedLogin: connectedGithubLogin,
		connectHref: getGithubConnectHref(),
	});

	function handleEnabledChange(enabled: boolean) {
		if (enabled && state !== 'ready') {
			return;
		}
		const nextGithub = enabled ? { ...github, enabled: true } : { ...github, enabled: false, actions: {} };
		onAutoSaveChange({
			...value,
			integrations: { ...value.integrations, github: nextGithub },
		});
	}

	function handleAddItem(key: GithubMenuItemKey) {
		if (state === 'needs-connect') {
			navigate({ to: '/settings/account' });
			return;
		}
		if (state !== 'ready') {
			return;
		}
		const nextActions = key === 'read' ? (github.actions ?? {}) : { ...(github.actions ?? {}), [key]: true };
		onAutoSaveChange({
			...value,
			integrations: {
				...value.integrations,
				github: { ...github, enabled: true, actions: nextActions },
			},
		});
	}

	function handleRemoveAction(key: GithubActionKey) {
		const nextActions = { ...(github.actions ?? {}), [key]: false };
		onAutoSaveChange({
			...value,
			integrations: {
				...value.integrations,
				github: { ...github, actions: nextActions },
			},
		});
	}

	const activeItems = getActiveGithubItems(github);

	return {
		state,
		description,
		activeItems,
		onAddItem: handleAddItem,
		onRemoveAction: handleRemoveAction,
		onEnabledChange: handleEnabledChange,
	};
}

function getActiveGithubItems(github: NonNullable<IntegrationConfig['github']>): GithubMenuItemKey[] {
	if (!github.enabled) {
		return [];
	}
	const actions = github.actions ?? {};
	const active: GithubMenuItemKey[] = ['read'];
	if (actions.createIssue) {
		active.push('createIssue');
	}
	if (actions.createPullRequest) {
		active.push('createPullRequest');
	}
	if (actions.addComment) {
		active.push('addComment');
	}
	return active;
}

function resolveGithubMenuState(
	available: boolean | undefined,
	status: { connected: boolean } | undefined,
): GithubMenuState {
	if (available === undefined) {
		return 'loading';
	}
	if (!available) {
		return 'unconfigured';
	}
	if (status === undefined) {
		return 'loading';
	}
	return status.connected ? 'ready' : 'needs-connect';
}

function getGithubIntegrationDescription({
	state,
	connectedLogin,
	connectHref,
}: {
	state: GithubMenuState;
	connectedLogin?: string;
	connectHref: string;
}): ReactNode {
	if (state === 'ready' && connectedLogin) {
		return (
			<>
				The agent can read issues, PRs, and files as{' '}
				<span className='font-medium text-foreground'>@{connectedLogin}</span>. Pick the write actions below to
				let it act on the repos too.
			</>
		);
	}

	if (state === 'unconfigured') {
		return 'GitHub integration is not configured for this workspace.';
	}

	if (state === 'loading') {
		return 'Checking GitHub connection...';
	}

	return (
		<>
			Let the agent read issues, PRs, and files, and act on them with the write actions you pick.{' '}
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
	if (!value.cron) {
		return 'weekly';
	}
	return value.scheduleDescription === CUSTOM_SCHEDULE_DESCRIPTION ? 'custom' : getScheduleOption(value.cron);
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
						actions: normalizeGithubActions(value.integrations.github.actions),
					}
				: undefined,
		},
	};
}

function normalizeGithubActions(actions: GithubActionsConfig | undefined): GithubActionsConfig {
	return {
		createIssue: Boolean(actions?.createIssue),
		createPullRequest: Boolean(actions?.createPullRequest),
		addComment: Boolean(actions?.addComment),
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
