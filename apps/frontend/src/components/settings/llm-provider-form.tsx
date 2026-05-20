import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Check, ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react';
import { getDefaultModelId, getProviderAuth } from '@nao/backend/provider-meta';
import { CustomModelDialog } from './custom-model-dialog';
import type { CustomModelMetadata } from '@nao/backend/llm';
import type { LlmProvider } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { capitalize } from '@/lib/utils';
import { PasswordField, TextField, TextareaField, FormError } from '@/components/ui/form-fields';

export interface LlmProviderFormProps {
	provider: LlmProvider;
	isEditing: boolean;
	usesEnvKey: boolean;
	initialValues?: {
		enabledModels: string[];
		customModels: CustomModelMetadata[];
		baseUrl: string;
	};
	currentModels: readonly { id: string; name: string; default?: boolean }[];
	onSubmit: (values: {
		apiKey?: string;
		credentials?: Record<string, string>;
		enabledModels: string[];
		customModels: CustomModelMetadata[];
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
	usesEnvKey,
	initialValues,
	currentModels,
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
	const providerAuth = getProviderAuth(provider);
	const showApiKey = providerAuth.apiKey !== 'none';
	const extraFields = providerAuth.extraFields ?? [];

	const defaultCredentials = Object.fromEntries(extraFields.map((f) => [f.name, '']));

	const form = useForm({
		defaultValues: {
			apiKey: '',
			credentials: defaultCredentials,
			enabledModels: initialValues?.enabledModels ?? [],
			customModels: initialValues?.customModels ?? ([] as CustomModelMetadata[]),
			baseUrl: initialValues?.baseUrl ?? '',
		},
		onSubmit: async ({ value }) => {
			const filledCredentials = Object.fromEntries(Object.entries(value.credentials).filter(([, v]) => v));

			await onSubmit({
				apiKey: value.apiKey || undefined,
				credentials: Object.keys(filledCredentials).length > 0 ? filledCredentials : undefined,
				enabledModels: value.enabledModels,
				customModels: value.customModels,
				baseUrl: value.baseUrl || undefined,
			});
		},
	});

	const getApiKeyHint = () => {
		if (providerAuth.apiKey === 'optional') {
			return providerAuth.hint ? `(${providerAuth.hint})` : '(optional)';
		}
		if (usesEnvKey) {
			return '(optional - leave empty to use env)';
		}
		if (isEditing) {
			return '(leave empty to keep current)';
		}
		return '';
	};

	const getApiKeyPlaceholder = () => {
		if (providerAuth.apiKey === 'optional') {
			return 'Enter bearer token or leave empty for env credentials';
		}
		if (usesEnvKey) {
			return 'Enter API key to override env variable';
		}
		if (isEditing) {
			return 'Enter new API key to update';
		}
		return `Enter your ${capitalize(provider)} API key`;
	};

	const isCustomModel = (modelId: string) => !currentModels.some((m) => m.id === modelId);

	const content = (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className='flex flex-col gap-3'
		>
			{/* Header */}
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-foreground capitalize'>
					{title}
					{usesEnvKey && <span className='text-muted-foreground font-normal ml-1'>(using env API key)</span>}
				</span>
				<Button variant='ghost' size='icon-sm' onClick={onCancel} type='button'>
					<X className='size-4' />
				</Button>
			</div>

			{showApiKey && (
				<PasswordField
					form={form}
					name='apiKey'
					label='API Key'
					hint={getApiKeyHint()}
					placeholder={getApiKeyPlaceholder()}
					required={providerAuth.apiKey === 'required' && !isEditing && !usesEnvKey}
				/>
			)}

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

					const handleAddCustomModel = () => {
						const trimmed = customModelInput.trim();
						if (!trimmed || enabledModels.includes(trimmed)) {
							return;
						}
						field.handleChange([...enabledModels, trimmed]);
						setCustomModelInput('');
					};

					return (
						<div className='grid gap-2'>
							<label className='text-sm font-medium text-foreground'>
								Enabled Models
								<span className='text-muted-foreground font-normal ml-1'>
									(leave empty for default {getDefaultModelId(provider)})
								</span>
							</label>
							<div className='flex flex-wrap gap-2'>
								{currentModels.map((model) => {
									const isExplicitlyEnabled = enabledModels.includes(model.id);
									const isDefaultSelected = enabledModels.length === 0 && model.default;
									const isEnabled = isExplicitlyEnabled || isDefaultSelected;
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
											handleAddCustomModel();
										}
									}}
									placeholder='Add custom model ID...'
									className='flex-1'
								/>
								<Button
									type='button'
									variant='outline'
									size='sm'
									onClick={handleAddCustomModel}
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
			<button
				type='button'
				onClick={() => setShowAdvanced(!showAdvanced)}
				className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
			>
				<ChevronDown className={`size-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
				Advanced settings
			</button>

			{/* Base URL (advanced) */}
			{showAdvanced && (
				<form.Field name='baseUrl'>
					{(field) => (
						<div className='grid gap-2 pl-4 border-l-2 border-border'>
							<label htmlFor='base-url' className='text-sm font-medium text-foreground'>
								Custom Base URL <span className='text-muted-foreground font-normal'>(optional)</span>
							</label>
							<Input
								id='base-url'
								type='url'
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								placeholder='e.g., https://your-proxy.com/v1'
							/>
							<p className='text-xs text-muted-foreground'>
								Use a custom endpoint instead of the default provider URL.
							</p>
						</div>
					)}
				</form.Field>
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
					modelId={editingCustomModelId ?? ''}
					value={field.state.value.find((m) => m.id === editingCustomModelId)}
					onSave={(metadata) => {
						const next = field.state.value.filter((m) => m.id !== metadata.id);
						field.handleChange([...next, metadata]);
					}}
				/>
			)}
		</form.Field>
	);

	if (noWrapper) {
		return (
			<>
				{content}
				{customModelDialog}
			</>
		);
	}

	return (
		<>
			<div className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'>{content}</div>
			{customModelDialog}
		</>
	);
}
