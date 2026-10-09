import {
	BACKGROUND_MODEL_CATEGORIES,
	BACKGROUND_MODEL_CATEGORY_DESCRIPTIONS,
	BACKGROUND_MODEL_CATEGORY_LABELS,
	setBackgroundModelForCategory,
	setBackgroundModelMode,
	setDefaultChatModel,
	setSingleBackgroundModel,
} from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useId } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { BackgroundModelCategory, BackgroundModelMode, DefaultModelSettings } from '@nao/shared';
import type { LlmProvider, LlmSelectedModel } from '@nao/shared/types';
import type { inferRouterOutputs } from '@trpc/server';
import type { ReactNode } from 'react';

import McpIcon from '@/components/icons/model-context-protocol.svg';
import { integrations } from '@/components/settings/integrations';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type DefaultModelsData = inferRouterOutputs<TrpcRouter>['project']['getDefaultModels'];
type AvailableModel = { provider: LlmProvider; modelId: string; name: string; baseUrl: string | null };
type ResolvedModel = { provider: LlmProvider; modelId: string; name: string };
type IntegrationModel = DefaultModelsData['integrations'][number];

const DEFAULT_VALUE = '__nao_default__';

interface DefaultModelsSectionProps {
	isAdmin: boolean;
}

export function DefaultModelsSection({ isAdmin }: DefaultModelsSectionProps) {
	const queryClient = useQueryClient();
	const { data } = useQuery(trpc.project.getDefaultModels.queryOptions());
	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.getDefaultModels.queryOptions().queryKey }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getDefaultChatModel.queryOptions().queryKey }),
		]);
	const updateMutation = useMutation(trpc.project.updateDefaultModels.mutationOptions({ onSuccess: invalidate }));
	const updateIntegrationMutation = useMutation(
		trpc.project.updateIntegrationModel.mutationOptions({ onSuccess: invalidate }),
	);

	const availableModels = (data?.availableModels ?? []) as AvailableModel[];
	const settings = data?.settings ?? null;
	const builtInDefaults = data?.builtInDefaults;
	const mode: BackgroundModelMode = settings?.mode ?? 'single';
	const disabled = !isAdmin || updateMutation.isPending || updateIntegrationMutation.isPending;
	const hasModels = availableModels.length > 0;
	const chatDefault = data?.chatModel ?? null;

	const save = (next: DefaultModelSettings) => updateMutation.mutate(next);

	const handleModeChange = (nextMode: BackgroundModelMode) => {
		if (nextMode !== mode) {
			save(setBackgroundModelMode(settings, nextMode));
		}
	};

	const handleIntegrationChange = (
		integration: IntegrationModel['integration'],
		selection: LlmSelectedModel | null,
	) => {
		updateIntegrationMutation.mutate({ integration, modelSelection: selection });
	};

	return (
		<SettingsCard
			title='Default models'
			description='Pick which models nao uses when nothing selects one explicitly. Every "nao default" shows the model it currently resolves to, so you can see what changes when you pick another one.'
		>
			{!hasModels ? (
				<p className='text-sm text-muted-foreground'>
					No models are available yet. Configure an LLM provider in the{' '}
					<span className='font-medium text-foreground'>LLM Configuration</span> section above.
				</p>
			) : (
				<div className='flex flex-col gap-8'>
					<SettingsGroup
						title='Chat & integrations'
						description='The model that answers users, in the chat and in every connected messaging tool.'
					>
						<ModelField
							label='New chats'
							description='The model the chat picker starts on. Users can still switch models while chatting.'
							value={settings?.chat}
							defaultOption={{ label: 'nao default', model: builtInDefaults?.chat }}
							availableModels={availableModels}
							disabled={disabled}
							onChange={(selection) => save(setDefaultChatModel(settings, selection))}
						/>
						{data?.integrations.map((integrationModel) => (
							<IntegrationModelField
								key={integrationModel.integration}
								integrationModel={integrationModel}
								chatDefault={chatDefault}
								availableModels={availableModels}
								disabled={disabled}
								onChange={(selection) =>
									handleIntegrationChange(integrationModel.integration, selection)
								}
							/>
						))}
						{data?.mcpEndpointEnabled && (
							<McpModelRow chatDefault={chatDefault} availableModels={availableModels} />
						)}
					</SettingsGroup>

					<SettingsGroup
						title='Background tasks'
						description='Helpers that run without a user picking a model.'
					>
						<ModeToggle mode={mode} onChange={handleModeChange} disabled={disabled} />

						{mode === 'single' ? (
							<>
								<ModelField
									label='Default for background tasks'
									description='Used for every background task listed below.'
									value={settings?.single}
									defaultOption={{ label: 'nao default', hint: 'a model per task' }}
									availableModels={availableModels}
									disabled={disabled}
									onChange={(selection) => save(setSingleBackgroundModel(settings, selection))}
								/>
								{!settings?.single && builtInDefaults && (
									<BuiltInTaskModels
										categories={builtInDefaults.categories}
										availableModels={availableModels}
									/>
								)}
							</>
						) : (
							<div className='flex flex-col gap-4'>
								{BACKGROUND_MODEL_CATEGORIES.map((category) => (
									<ModelField
										key={category}
										label={BACKGROUND_MODEL_CATEGORY_LABELS[category]}
										description={BACKGROUND_MODEL_CATEGORY_DESCRIPTIONS[category]}
										value={settings?.categories?.[category]}
										defaultOption={{
											label: 'nao default',
											model: builtInDefaults?.categories[category],
										}}
										availableModels={availableModels}
										disabled={disabled}
										onChange={(selection) =>
											save(setBackgroundModelForCategory(settings, category, selection))
										}
									/>
								))}
							</div>
						)}
					</SettingsGroup>
				</div>
			)}
		</SettingsCard>
	);
}

function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
	return (
		<section className='flex flex-col gap-4'>
			<div className='grid gap-0.5'>
				<h4 className='text-sm font-semibold text-foreground'>{title}</h4>
				<p className='text-xs text-muted-foreground'>{description}</p>
			</div>
			{children}
		</section>
	);
}

function ModeToggle({
	mode,
	onChange,
	disabled,
}: {
	mode: BackgroundModelMode;
	onChange: (mode: BackgroundModelMode) => void;
	disabled: boolean;
}) {
	const options: { value: BackgroundModelMode; label: string }[] = [
		{ value: 'single', label: 'One default for everything' },
		{ value: 'perCategory', label: 'A model per task' },
	];

	return (
		<div className='inline-flex w-fit rounded-lg border border-border p-0.5'>
			{options.map((option) => (
				<button
					key={option.value}
					type='button'
					disabled={disabled}
					onClick={() => onChange(option.value)}
					className={cn(
						'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
						mode === option.value
							? 'bg-secondary text-foreground'
							: 'text-muted-foreground hover:text-foreground',
						disabled && 'cursor-not-allowed opacity-60',
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function IntegrationModelField({
	integrationModel,
	chatDefault,
	availableModels,
	disabled,
	onChange,
}: {
	integrationModel: IntegrationModel;
	chatDefault: ResolvedModel | null;
	availableModels: AvailableModel[];
	disabled: boolean;
	onChange: (selection: LlmSelectedModel | null) => void;
}) {
	const integration = integrations.find((candidate) => candidate.id === integrationModel.integration);
	if (!integration) {
		return null;
	}
	const Icon = integration.icon;

	return (
		<ModelField
			icon={<Icon className='size-4' />}
			label={
				<Link
					to='/settings/project/integrations/$integrationId'
					params={{ integrationId: integration.id }}
					className='inline-flex items-center gap-1 hover:underline'
				>
					{integration.name}
					<ArrowUpRight className='size-3.5 text-muted-foreground' />
				</Link>
			}
			description={`The model used to answer questions asked in ${integration.name}.`}
			value={integrationModel.modelSelection ?? undefined}
			unavailableWarning={`The selected model is no longer offered to users. ${integration.name} keeps requesting it, so pick another model to keep answers reliable.`}
			defaultOption={{ label: 'Default chat model', model: chatDefault }}
			availableModels={availableModels}
			disabled={disabled}
			onChange={onChange}
		/>
	);
}

function McpModelRow({
	chatDefault,
	availableModels,
}: {
	chatDefault: ResolvedModel | null;
	availableModels: AvailableModel[];
}) {
	const baseUrl = chatDefault ? findModel(availableModels, chatDefault)?.baseUrl : null;

	return (
		<div className='grid gap-1.5'>
			<div className='flex items-center gap-2'>
				<McpIcon className='size-4' />
				<Link
					to='/settings/project/integrations'
					search={{ tab: 'nao-mcp' }}
					className='inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline'
				>
					nao MCP · ask_nao
					<ArrowUpRight className='size-3.5 text-muted-foreground' />
				</Link>
			</div>
			<p className='text-xs text-muted-foreground'>
				Questions asked by external AI clients through the nao MCP endpoint run on the default chat model.
			</p>
			<div className='flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground'>
				{chatDefault ? (
					<>
						<LlmProviderIcon provider={chatDefault.provider} baseUrl={baseUrl ?? null} className='size-4' />
						<span>{chatDefault.name}</span>
					</>
				) : (
					<span>No model available</span>
				)}
			</div>
		</div>
	);
}

function BuiltInTaskModels({
	categories,
	availableModels,
}: {
	categories: Partial<Record<BackgroundModelCategory, ResolvedModel>>;
	availableModels: AvailableModel[];
}) {
	return (
		<dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs'>
			{BACKGROUND_MODEL_CATEGORIES.map((category) => {
				const model = categories[category];
				return (
					<div key={category} className='contents'>
						<dt className='text-muted-foreground'>{BACKGROUND_MODEL_CATEGORY_LABELS[category]}</dt>
						<dd className='flex items-center gap-1.5 text-foreground'>
							{model ? (
								<>
									<LlmProviderIcon
										provider={model.provider}
										baseUrl={findModel(availableModels, model)?.baseUrl ?? null}
										className='size-3.5'
									/>
									{model.name}
								</>
							) : (
								<span className='text-muted-foreground'>No model available</span>
							)}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}

interface DefaultOption {
	label: string;
	model?: ResolvedModel | null;
	hint?: string;
}

const FALLBACK_UNAVAILABLE_WARNING =
	'The selected model is no longer available. nao automatically falls back to another available model until you pick a new one.';

function ModelField({
	icon,
	label,
	description,
	value,
	unavailableWarning = FALLBACK_UNAVAILABLE_WARNING,
	defaultOption,
	availableModels,
	disabled,
	onChange,
}: {
	icon?: ReactNode;
	label: ReactNode;
	description: string;
	value: LlmSelectedModel | undefined;
	unavailableWarning?: string;
	defaultOption: DefaultOption;
	availableModels: AvailableModel[];
	disabled: boolean;
	onChange: (selection: LlmSelectedModel | null) => void;
}) {
	const labelId = useId();
	const descriptionId = useId();
	const selected = value ? findModel(availableModels, value) : null;
	const isUnavailable = !!value && !selected;

	const handleChange = (nextValue: string) => {
		if (nextValue === DEFAULT_VALUE) {
			onChange(null);
			return;
		}
		const model = availableModels.find((m) => modelValue(m) === nextValue);
		if (model) {
			onChange({ provider: model.provider, modelId: model.modelId });
		}
	};

	return (
		<div className='grid gap-1.5'>
			<div className='flex items-center gap-2'>
				{icon}
				<label id={labelId} className='text-sm font-medium text-foreground'>
					{label}
				</label>
				{isUnavailable && (
					<SimpleTooltip content={unavailableWarning}>
						<AlertTriangle className='size-3.5 text-amber-500' />
					</SimpleTooltip>
				)}
			</div>
			<p id={descriptionId} className='text-xs text-muted-foreground'>
				{description}
			</p>
			<Select value={value ? modelValue(value) : DEFAULT_VALUE} onValueChange={handleChange} disabled={disabled}>
				<SelectTrigger className='w-full' aria-labelledby={labelId} aria-describedby={descriptionId}>
					<SelectValue>
						{value ? (
							<div className='flex items-center gap-2'>
								<LlmProviderIcon
									provider={value.provider}
									baseUrl={selected?.baseUrl ?? null}
									className='size-4'
								/>
								<span className={cn(isUnavailable && 'text-amber-600 dark:text-amber-500')}>
									{selected?.name ?? value.modelId}
								</span>
							</div>
						) : (
							<DefaultOptionContent option={defaultOption} availableModels={availableModels} />
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={DEFAULT_VALUE}>
						<DefaultOptionContent option={defaultOption} availableModels={availableModels} />
					</SelectItem>
					{availableModels.map((model) => (
						<SelectItem key={modelValue(model)} value={modelValue(model)}>
							<LlmProviderIcon provider={model.provider} baseUrl={model.baseUrl} className='size-4' />
							{model.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function DefaultOptionContent({
	option,
	availableModels,
}: {
	option: DefaultOption;
	availableModels: AvailableModel[];
}) {
	const { label, model, hint } = option;
	const detail = model ? model.name : hint;

	return (
		<div className='flex items-center gap-2'>
			{model && (
				<LlmProviderIcon
					provider={model.provider}
					baseUrl={findModel(availableModels, model)?.baseUrl ?? null}
					className='size-4'
				/>
			)}
			<span className='text-muted-foreground'>
				{label}
				{detail && <span> · {detail}</span>}
			</span>
		</div>
	);
}

function findModel(availableModels: AvailableModel[], model: LlmSelectedModel): AvailableModel | undefined {
	return availableModels.find((m) => m.provider === model.provider && m.modelId === model.modelId);
}

function modelValue(model: { provider: string; modelId: string }): string {
	return JSON.stringify([model.provider, model.modelId]);
}
