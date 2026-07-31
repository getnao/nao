import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Check, ChevronDown, MoreHorizontal, Plus, TriangleAlert, X } from 'lucide-react';
import { getDefaultModelId, getModelParameterSpec, getProviderAuth, PROVIDER_META } from '@nao/backend/provider-meta';
import { NAMED_PROVIDER_KIND, providerKind, providerLabels, toProviderName } from '@nao/shared/types';
import { CustomModelDialog } from './custom-model-dialog';
import { ModelParametersDialog } from './model-parameters-dialog';
import { applySavedModelSettings } from './model-settings-overrides';
import type { CustomModelMetadata, ModelSettingsMap } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordField, TextField, TextareaField, FormError } from '@/components/ui/form-fields';

/** Where credentials already come from when the UI is only layering settings on top. */
export type InheritedKeySource = 'env' | 'config';

const INHERITED_KEY_LABELS: Record<InheritedKeySource, string> = {
	env: 'env',
	config: 'nao_config.yaml',
};

export interface LlmProviderFormProps {
	provider: LlmProvider;
	isEditing: boolean;
	inheritedKeySource: InheritedKeySource | null;
	initialValues?: {
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		modelSettings: ModelSettingsMap;
		baseUrl: string;
	};
	currentModels: readonly { id: string; name: string; default?: boolean }[];
	takenNames?: readonly string[];
	onSubmit: (values: {
		apiKey?: string;
		credentials?: Record<string, string>;
		name?: string;
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		modelSettings: ModelSettingsMap;
		baseUrl?: string;
	}) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	error: { message: string } | null;
	title: string;
	showPlusIcon?: boolean;
	noWrapper?: boolean;
}

export function LlmProviderForm({
	provider,
	isEditing,
	inheritedKeySource,
	initialValues,
	currentModels,
	takenNames = [],
	onSubmit,
	onCancel,
	isPending,
	error,
	title,
	showPlusIcon = false,
	noWrapper = false,
}: LlmProviderFormProps) {
	const [showAdvanced, setShowAdvanced] = useState(!!initialValues?.baseUrl);
	const [customModelInput, setCustomModelInput] = useState('');
	const [editingCustomModelId, setEditingCustomModelId] = useState<string | null>(null);
	const [editingModelParamsId, setEditingModelParamsId] = useState<string | null>(null);
	const supportsModelParameters = (modelId: string) => getModelParameterSpec(provider, modelId).length > 0;
	const providerAuth = getProviderAuth(provider);
	const showApiKey = providerAuth.apiKey !== 'none';
	const extraFields = providerAuth.extraFields ?? [];
	const kind = providerKind(provider);
	const providerLabel = providerLabels[kind];
	const providerMeta = PROVIDER_META[kind];
	const defaultModelId = getDefaultModelId(provider);
	// A project can hold several endpoints of this kind, told apart by the name given here.
	const needsName = !isEditing && kind === NAMED_PROVIDER_KIND;

	const defaultCredentials = Object.fromEntries(extraFields.map((f) => [f.name, '']));
	const inheritedKeyLabel = inheritedKeySource ? INHERITED_KEY_LABELS[inheritedKeySource] : null;

	const form = useForm({
		defaultValues: {
			apiKey: '',
			credentials: defaultCredentials,
			name: '',
			enabledModels: initialValues?.enabledModels ?? [],
			customModels: initialValues?.customModels ?? ([] as CustomModelMetadata[]),
			modelSettings: initialValues?.modelSettings ?? ({} as ModelSettingsMap),
			baseUrl: initialValues?.baseUrl ?? '',
		},
		onSubmit: async ({ value }) => {
			const filledCredentials = Object.fromEntries(Object.entries(value.credentials).filter(([, v]) => v));

			await onSubmit({
				apiKey: value.apiKey || undefined,
				credentials: Object.keys(filledCredentials).length > 0 ? filledCredentials : undefined,
				name: needsName ? value.name : undefined,
				enabledModels: value.enabledModels,
				customModels: value.customModels,
				modelSettings: value.modelSettings,
				baseUrl: value.baseUrl || undefined,
			});
		},
	});

	const getApiKeyHint = () => {
		if (inheritedKeyLabel) {
			return `(optional - leave empty to use ${inheritedKeyLabel})`;
		}
		if (providerAuth.apiKey === 'optional') {
			return providerAuth.hint ? `(${providerAuth.hint})` : '(optional)';
		}
		if (isEditing) {
			return '(leave empty to keep current)';
		}
		return '';
	};

	const getApiKeyPlaceholder = () => {
		if (inheritedKeyLabel) {
			const credentialLabel = providerAuth.apiKey === 'optional' ? 'bearer token' : 'API key';
			return `Enter ${credentialLabel} to override ${inheritedKeyLabel}`;
		}
		if (providerAuth.apiKey === 'optional') {
			return 'Enter bearer token or leave empty for env credentials';
		}
		if (isEditing) {
			return 'Enter new API key to update';
		}
		return `Enter your ${providerLabel} API key`;
	};

	const isCustomModel = (modelId: string) => !currentModels.some((m) => m.id === modelId);

	const addCustomModel = () => {
		const trimmed = customModelInput.trim();
		if (!trimmed) {
			return;
		}
		const enabledModels = form.getFieldValue('enabledModels');
		if (!enabledModels.includes(trimmed)) {
			form.setFieldValue('enabledModels', [...enabledModels, trimmed]);
		}
		setCustomModelInput('');
	};

	const nameError = (value: string): string | undefined => {
		const normalized = toProviderName(value);
		if (!value) {
			return undefined;
		}
		if (!normalized) {
			return 'Name this endpoint with letters, digits and dashes.';
		}
		return takenNames.includes(normalized) ? `An endpoint named ${normalized} already exists.` : undefined;
	};

	const nameField = (
		<form.Field name='name' validators={{ onChange: ({ value }: { value: string }) => nameError(value) }}>
			{(field) => {
				const normalized = toProviderName(field.state.value);
				const invalid = nameError(field.state.value);
				return (
					<div className='grid gap-2'>
						<label htmlFor='provider-name' className='text-sm font-medium text-foreground'>
							Name <span className='text-muted-foreground font-normal'>(required)</span>
						</label>
						<Input
							id='provider-name'
							type='text'
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
							onBlur={field.handleBlur}
							required
							placeholder='e.g., my-vllm'
						/>
						<p className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
							{invalid ??
								(normalized
									? `Models of this endpoint are listed under ${normalized}.`
									: 'How this endpoint is named across the app, so you can add several of them.')}
						</p>
					</div>
				);
			}}
		</form.Field>
	);

	const baseUrlField = (
		<form.Field name='baseUrl'>
			{(field) => (
				<div
					className={providerMeta.requiresBaseUrl ? 'grid gap-2' : 'grid gap-2 pl-4 border-l-2 border-border'}
				>
					<label htmlFor='base-url' className='text-sm font-medium text-foreground'>
						Base URL{' '}
						<span className='text-muted-foreground font-normal'>
							{providerMeta.requiresBaseUrl ? '(required)' : '(optional)'}
						</span>
					</label>
					<Input
						id='base-url'
						type='url'
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
						required={providerMeta.requiresBaseUrl}
						placeholder={`e.g., ${providerMeta.defaultBaseUrl ?? 'http://localhost:8000/v1'}`}
					/>
					<p className='text-xs text-muted-foreground'>
						{providerMeta.requiresBaseUrl
							? 'The OpenAI-compatible endpoint to call, up to and including its version segment.'
							: 'Use a custom endpoint instead of the default provider URL.'}
					</p>
				</div>
			)}
		</form.Field>
	);

	const content = (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				addCustomModel();
				form.handleSubmit();
			}}
			className='flex flex-col gap-3'
		>
			{/* Header */}
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-foreground'>
					{title}
					{inheritedKeyLabel && (
						<span className='text-muted-foreground font-normal ml-1'>
							(using {inheritedKeyLabel} API key)
						</span>
					)}
				</span>
				<Button variant='ghost' size='icon-sm' onClick={onCancel} type='button'>
					<X className='size-4' />
				</Button>
			</div>

			{inheritedKeySource === 'config' && (
				<div className='flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20'>
					<TriangleAlert className='size-4 shrink-0 mt-0.5 text-amber-500' />
					<p className='text-xs text-amber-700 dark:text-amber-400'>
						This provider is defined in <span className='font-mono'>nao_config.yaml</span>. Settings saved
						here are stored in the project and take precedence over the file, so later edits to{' '}
						<span className='font-mono'>nao_config.yaml</span> are ignored until you delete this provider
						here.
					</p>
				</div>
			)}

			{needsName && nameField}

			{showApiKey && (
				<PasswordField
					form={form}
					name='apiKey'
					label='API Key'
					hint={getApiKeyHint()}
					placeholder={getApiKeyPlaceholder()}
					required={providerAuth.apiKey === 'required' && !isEditing && !inheritedKeySource}
				/>
			)}

			{providerMeta.requiresBaseUrl && baseUrlField}

			{extraFields.map((field) => {
				const FieldComponent = field.multiline ? TextareaField : field.secret ? PasswordField : TextField;
				const hint = isEditing ? '(leave empty to keep current)' : `(or set ${field.envVar} in env)`;
				return (
					<FieldComponent
						key={field.name}
						form={form}
						name={`credentials.${field.name}`}
						label={field.label}
						hint={hint}
						placeholder={field.placeholder ?? `Enter ${field.label}`}
					/>
				);
			})}

			{/* Model selection */}
			<form.Field name='enabledModels'>
				{(field) => {
					const enabledModels = field.state.value;

					const toggleModel = (modelId: string) => {
						if (enabledModels.includes(modelId)) {
							field.handleChange(enabledModels.filter((m) => m !== modelId));
							return;
						}

						// First selection while default is implicitly selected - keep the default too
						if (enabledModels.length === 0) {
							const defaultModel = currentModels.find((m) => m.default);
							if (defaultModel && defaultModel.id !== modelId) {
								field.handleChange([defaultModel.id, modelId]);
								return;
							}
						}

						field.handleChange([...enabledModels, modelId]);
					};

					return (
						<div className='grid gap-2'>
							<label className='text-sm font-medium text-foreground'>
								Enabled Models
								<span className='text-muted-foreground font-normal ml-1'>
									{defaultModelId
										? `(leave empty for default ${defaultModelId})`
										: '(add the model IDs your endpoint serves)'}
								</span>
							</label>
							<div className='flex flex-wrap gap-2'>
								{currentModels.map((model) => {
									const isExplicitlyEnabled = enabledModels.includes(model.id);
									const isDefaultSelected = enabledModels.length === 0 && model.default;
									const isEnabled = isExplicitlyEnabled || isDefaultSelected;

									if (isEnabled && supportsModelParameters(model.id)) {
										return (
											<div
												key={model.id}
												className='flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-md text-sm bg-primary text-primary-foreground'
											>
												<button
													type='button'
													onClick={() => toggleModel(model.id)}
													className='flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity'
												>
													<Check className='size-3' />
													{model.name}
												</button>
												<button
													type='button'
													onClick={() => setEditingModelParamsId(model.id)}
													className='ml-1 p-0.5 rounded hover:bg-primary-foreground/20 transition-colors cursor-pointer'
													aria-label={`Edit ${model.name} parameters`}
												>
													<MoreHorizontal className='size-3.5' />
												</button>
											</div>
										);
									}

									return (
										<button
											key={model.id}
											type='button'
											onClick={() => toggleModel(model.id)}
											className={`
												flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer
												${isEnabled ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}
											`}
										>
											{isEnabled && <Check className='size-3' />}
											{model.name}
										</button>
									);
								})}
								<form.Field name='customModels'>
									{(customModelsField) => {
										const customModels = customModelsField.state.value;
										return (
											<>
												{enabledModels.filter(isCustomModel).map((modelId) => {
													const metadata = customModels.find((m) => m.id === modelId);
													const label = metadata?.displayName?.trim() || modelId;
													return (
														<div
															key={modelId}
															className='flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-sm bg-primary text-primary-foreground'
														>
															<button
																type='button'
																onClick={() => toggleModel(modelId)}
																className='cursor-pointer hover:opacity-80 transition-opacity'
																aria-label={`Remove ${modelId}`}
															>
																<X className='size-2.5' />
															</button>
															<span title={modelId}>{label}</span>
															<button
																type='button'
																onClick={() => setEditingCustomModelId(modelId)}
																className='ml-1 p-0.5 rounded hover:bg-primary-foreground/20 transition-colors cursor-pointer'
																aria-label={`Edit ${modelId}`}
															>
																<MoreHorizontal className='size-3.5' />
															</button>
														</div>
													);
												})}
											</>
										);
									}}
								</form.Field>
							</div>
							<div className='flex gap-2 mt-1'>
								<Input
									type='text'
									value={customModelInput}
									onChange={(e) => setCustomModelInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											addCustomModel();
										}
									}}
									placeholder='Add custom model ID...'
									className='flex-1'
								/>
								<Button
									type='button'
									variant='outline'
									size='sm'
									onClick={addCustomModel}
									disabled={!customModelInput.trim()}
								>
									<Plus className='size-4' />
								</Button>
							</div>
						</div>
					);
				}}
			</form.Field>

			{/* Advanced settings toggle */}
			{!providerMeta.requiresBaseUrl && (
				<>
					<button
						type='button'
						onClick={() => setShowAdvanced(!showAdvanced)}
						className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
					>
						<ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
						Advanced settings
					</button>
					{showAdvanced && baseUrlField}
				</>
			)}

			{/* Error display */}
			{error && <FormError error={error.message} />}

			{/* Action buttons */}
			<div className='flex justify-end gap-2 pt-2'>
				<Button variant='ghost' size='sm' onClick={onCancel} type='button'>
					Cancel
				</Button>
				<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
					{(canSubmit: boolean) => (
						<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
							{showPlusIcon && <Plus className='size-4 mr-1' />}
							{isEditing ? 'Save Changes' : 'Save'}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);

	const customModelDialog = (
		<form.Field name='customModels'>
			{(field) => (
				<CustomModelDialog
					open={editingCustomModelId !== null}
					onOpenChange={(open) => {
						if (!open) {
							setEditingCustomModelId(null);
						}
					}}
					provider={provider}
					modelId={editingCustomModelId ?? ''}
					value={field.state.value.find((m) => m.id === editingCustomModelId)}
					onSave={(metadata) => {
						const next = field.state.value.filter((m) => m.id !== metadata.id);
						field.handleChange([...next, metadata]);
					}}
					parametersValue={
						editingCustomModelId ? form.getFieldValue('modelSettings')[editingCustomModelId] : undefined
					}
					onSaveParameters={(settings) => {
						if (!editingCustomModelId) {
							return;
						}
						const next = applySavedModelSettings({
							provider,
							enabledModels: form.getFieldValue('enabledModels'),
							modelSettings: form.getFieldValue('modelSettings'),
							modelId: editingCustomModelId,
							settings,
						});
						form.setFieldValue('modelSettings', next.modelSettings);
					}}
				/>
			)}
		</form.Field>
	);

	const modelParametersDialog = (
		<form.Field name='modelSettings'>
			{(field) => {
				const model = currentModels.find((m) => m.id === editingModelParamsId);
				return (
					<ModelParametersDialog
						open={editingModelParamsId !== null}
						onOpenChange={(open) => {
							if (!open) {
								setEditingModelParamsId(null);
							}
						}}
						provider={provider}
						model={{
							id: editingModelParamsId ?? '',
							name: model?.name ?? editingModelParamsId ?? '',
						}}
						value={editingModelParamsId ? field.state.value[editingModelParamsId] : undefined}
						onSave={(settings) => {
							if (!editingModelParamsId) {
								return;
							}
							const enabledModels = form.getFieldValue('enabledModels');
							const next = applySavedModelSettings({
								provider,
								enabledModels,
								modelSettings: field.state.value,
								modelId: editingModelParamsId,
								settings,
							});
							if (next.enabledModels !== enabledModels) {
								form.setFieldValue('enabledModels', next.enabledModels);
							}
							field.handleChange(next.modelSettings);
						}}
					/>
				);
			}}
		</form.Field>
	);

	if (noWrapper) {
		return (
			<>
				{content}
				{customModelDialog}
				{modelParametersDialog}
			</>
		);
	}

	return (
		<>
			<div className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'>{content}</div>
			{customModelDialog}
			{modelParametersDialog}
		</>
	);
}
