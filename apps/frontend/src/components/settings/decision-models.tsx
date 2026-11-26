import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Play, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';

import { Button } from '@/components/ui/button';
import { FormActions, PasswordField, TextField } from '@/components/ui/form-fields';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

type DecisionSettings = inferRouterOutputs<TrpcRouter>['decision']['getSettings'];
type DecisionProviderView = DecisionSettings['providers'][number];
type DecisionModel = NonNullable<DecisionSettings['model']>;
type KeySource = NonNullable<DecisionProviderView['source']>;

const SOURCE_BADGES: Record<KeySource, string | null> = {
	project: null,
	config: 'nao_config.yaml',
	llm: 'LLM configuration',
	env: 'ENV',
};

const INHERITED_KEY_HINTS: Record<KeySource, string> = {
	project: '(leave empty to keep current)',
	config: '(overrides the key of nao_config.yaml)',
	llm: '(overrides the key of the LLM configuration)',
	env: '(overrides the key of the environment)',
};

export function SettingsDecisionModels({ isAdmin }: { isAdmin: boolean }) {
	const settings = useQuery(trpc.decision.getSettings.queryOptions());
	const providers = settings.data?.providers ?? [];
	const connectedProviders = providers.filter((provider) => provider.source !== null);
	const model = settings.data?.model ?? null;

	return (
		<>
			<SettingsCard
				title='Decision providers'
				description='Decision models (System 1) answer yes/no, pick-one and scoring questions in milliseconds, with a probability instead of text. A provider also set up as an LLM provider uses the same API key.'
			>
				<DecisionProviders providers={providers} isAdmin={isAdmin} isLoaded={settings.isSuccess} />
			</SettingsCard>

			{connectedProviders.length > 0 && (
				<SettingsCard title='Decision model' description='The model decisions run on.'>
					<DecisionModelPicker
						key={`${model?.provider}/${model?.modelId}`}
						providers={connectedProviders}
						model={model}
						isAdmin={isAdmin}
					/>
				</SettingsCard>
			)}

			{model && <QuickEditsToggle isEnabled={settings.data?.quickEditsEnabled ?? false} isAdmin={isAdmin} />}

			{isAdmin && model && <DecisionModelTest model={model} />}
		</>
	);
}

function useInvalidateDecisionSettings() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.decision.getSettings.queryOptions().queryKey }),
			queryClient.invalidateQueries({ queryKey: trpc.project.getLlmConfigs.queryOptions().queryKey }),
		]);
}

function QuickEditsToggle({ isEnabled, isAdmin }: { isEnabled: boolean; isAdmin: boolean }) {
	const invalidate = useInvalidateDecisionSettings();
	const setQuickEdits = useMutation(trpc.decision.setQuickEdits.mutationOptions({ onSuccess: invalidate }));

	return (
		<SettingsCard title='Quick edits' description='Changes the decision model makes without an agent run.' divide>
			<SettingsControlRow
				id='decision-quick-edits'
				label='Quick chart edits'
				description='When a chat message only restyles a story chart (its type, legend, values, Y-axis), the decision model edits the chart in milliseconds instead of the agent.'
				control={
					<Switch
						id='decision-quick-edits'
						checked={isEnabled}
						onCheckedChange={(enabled) => setQuickEdits.mutate({ enabled })}
						disabled={!isAdmin || setQuickEdits.isPending}
					/>
				}
			/>
		</SettingsCard>
	);
}

function DecisionProviders({
	providers,
	isAdmin,
	isLoaded,
}: {
	providers: DecisionProviderView[];
	isAdmin: boolean;
	isLoaded: boolean;
}) {
	const [editedProvider, setEditedProvider] = useState<DecisionProviderView['provider'] | null>(null);
	const invalidate = useInvalidateDecisionSettings();
	const deleteProvider = useMutation(trpc.decision.deleteProvider.mutationOptions({ onSuccess: invalidate }));

	const connected = providers.filter((provider) => provider.source !== null);
	const available = providers.filter((provider) => provider.source === null);
	const addedProvider = available.find((provider) => provider.provider === editedProvider);

	return (
		<div className='grid gap-4'>
			{connected.map((provider) =>
				provider.provider === editedProvider ? (
					<ProviderForm key={provider.provider} provider={provider} onClose={() => setEditedProvider(null)} />
				) : (
					<ProviderRow
						key={provider.provider}
						provider={provider}
						isAdmin={isAdmin}
						isBusy={editedProvider !== null || deleteProvider.isPending}
						onEdit={() => setEditedProvider(provider.provider)}
						onDelete={() => deleteProvider.mutate({ provider: provider.provider })}
					/>
				),
			)}

			{isAdmin && addedProvider && (
				<ProviderForm provider={addedProvider} onClose={() => setEditedProvider(null)} />
			)}

			{isAdmin && !editedProvider && available.length > 0 && (
				<div className='grid gap-2 p-4 rounded-lg border border-dashed border-border'>
					<label className='text-sm font-medium text-foreground'>Add Provider</label>
					<div className='flex flex-wrap gap-2'>
						{available.map((provider) => (
							<button
								key={provider.provider}
								type='button'
								onClick={() => setEditedProvider(provider.provider)}
								className='px-4 py-2 rounded-md text-sm font-medium transition-all cursor-pointer bg-secondary text-muted-foreground hover:text-foreground'
							>
								{provider.label}
							</button>
						))}
					</div>
				</div>
			)}

			{isLoaded && !isAdmin && connected.length === 0 && (
				<p className='text-sm text-muted-foreground'>
					No decision provider is connected. Contact an admin to set one up.
				</p>
			)}
		</div>
	);
}

function ProviderRow({
	provider,
	isAdmin,
	isBusy,
	onEdit,
	onDelete,
}: {
	provider: DecisionProviderView;
	isAdmin: boolean;
	isBusy: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const badge = provider.source && SOURCE_BADGES[provider.source];
	const credentialPreviews = Object.entries(provider.credentialPreviews ?? {});

	return (
		<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30'>
			<div className='flex-1 grid gap-1 min-w-0'>
				<div className='flex items-center gap-2'>
					<span className='text-sm font-medium text-foreground'>{provider.label}</span>
					{badge && (
						<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>
							{badge}
						</span>
					)}
				</div>
				<div className='flex items-center gap-2 text-xs text-muted-foreground flex-wrap'>
					{provider.apiKeyPreview ? (
						<span className='font-mono'>{provider.apiKeyPreview}</span>
					) : (
						<span>{describeInheritedAccess(provider)}</span>
					)}
					{credentialPreviews.map(([name, preview]) => (
						<span key={name} className='font-mono'>
							{provider.extraFields.find((field) => field.name === name)?.label ?? name}: {preview}
						</span>
					))}
					{provider.baseUrl && (
						<>
							<span className='text-border'>•</span>
							<span className='truncate max-w-[240px]' title={provider.baseUrl}>
								{provider.baseUrl}
							</span>
						</>
					)}
				</div>
			</div>
			{isAdmin && (
				<div className='flex items-center gap-1'>
					<Button variant='ghost' size='icon-sm' onClick={onEdit} disabled={isBusy}>
						<Pencil className='size-3 text-muted-foreground' />
					</Button>
					{provider.isSaved && (
						<Button variant='ghost' size='icon-sm' onClick={onDelete} disabled={isBusy}>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

function describeInheritedAccess(provider: DecisionProviderView): string {
	if (provider.source === 'llm') {
		return `Uses the ${provider.label} credentials of the LLM configuration`;
	}
	return provider.source === 'env' ? 'Credentials from environment' : 'No API key';
}

function ProviderForm({ provider, onClose }: { provider: DecisionProviderView; onClose: () => void }) {
	const invalidate = useInvalidateDecisionSettings();
	const upsertProvider = useMutation(trpc.decision.upsertProvider.mutationOptions());
	const keepsSavedValues = provider.isSaved;
	const keptValueHint = keepsSavedValues ? '(leave empty to keep current)' : undefined;
	const optionalKeyHint = provider.apiKey === 'optional' ? '(optional)' : undefined;

	const form = useForm({
		defaultValues: {
			apiKey: '',
			baseUrl: keepsSavedValues ? (provider.baseUrl ?? '') : '',
			credentials: Object.fromEntries(provider.extraFields.map((field) => [field.name, ''])),
		},
		onSubmit: async ({ value }) => {
			await upsertProvider.mutateAsync({
				provider: provider.provider,
				apiKey: value.apiKey || undefined,
				baseUrl: value.baseUrl.trim(),
				credentials: value.credentials,
			});
			await invalidate();
			onClose();
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
			className='flex flex-col gap-3 p-4 rounded-lg border border-primary/50 bg-muted/30'
		>
			<div className='flex items-center justify-between'>
				<span className='text-sm font-medium text-foreground'>
					{provider.source ? 'Edit' : 'Add'} {provider.label}
				</span>
				<Button variant='ghost' size='icon-sm' onClick={onClose} type='button'>
					<X className='size-4' />
				</Button>
			</div>

			<PasswordField
				form={form}
				name='apiKey'
				label='API Key'
				hint={provider.source ? INHERITED_KEY_HINTS[provider.source] : optionalKeyHint}
				placeholder={`Enter your ${provider.label} API key`}
				required={provider.apiKey === 'required' && !keepsSavedValues}
			/>

			{provider.extraFields.map((field) => (
				<TextField
					key={field.name}
					form={form}
					name={`credentials.${field.name}`}
					label={field.label}
					hint={keptValueHint}
					placeholder={`Enter ${field.label}`}
					required={!keepsSavedValues}
				/>
			))}

			<TextField
				form={form}
				name='baseUrl'
				label='Base URL'
				hint={provider.requiresBaseUrl ? undefined : '(optional)'}
				placeholder='https://…'
				required={provider.requiresBaseUrl}
			/>

			{upsertProvider.error && <p className='text-sm text-destructive'>{upsertProvider.error.message}</p>}

			<FormActions form={form} submitText='Save' onCancel={onClose} isPending={upsertProvider.isPending} />
		</form>
	);
}

function DecisionModelPicker({
	providers,
	model,
	isAdmin,
}: {
	providers: DecisionProviderView[];
	model: DecisionModel | null;
	isAdmin: boolean;
}) {
	const invalidate = useInvalidateDecisionSettings();
	const setModel = useMutation(trpc.decision.setModel.mutationOptions({ onSuccess: invalidate }));
	const [draft, setDraft] = useState({
		provider: model?.provider ?? providers[0].provider,
		modelId: model?.modelId ?? '',
	});
	const provider = providers.find((candidate) => candidate.provider === draft.provider) ?? providers[0];
	const isDisabled = !isAdmin || setModel.isPending;

	const saveModel = (next: DecisionModel) => {
		setDraft(next);
		const isUnchanged = next.provider === model?.provider && next.modelId === model.modelId;
		if (next.modelId && !isUnchanged) {
			setModel.mutate(next);
		}
	};

	const changeProvider = (providerId: string) => {
		const selected = providers.find((candidate) => candidate.provider === providerId) ?? provider;
		saveModel({ provider: selected.provider, modelId: selected.models.at(0)?.id ?? '' });
	};

	return (
		<div className='grid gap-4 sm:grid-cols-2'>
			<div className='grid gap-2'>
				<label className='text-sm font-medium text-foreground'>Provider</label>
				<Select value={provider.provider} onValueChange={changeProvider} disabled={isDisabled}>
					<SelectTrigger className='w-full'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{providers.map((candidate) => (
							<SelectItem key={candidate.provider} value={candidate.provider}>
								{candidate.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className='grid gap-2'>
				<label htmlFor='decision-model-id' className='text-sm font-medium text-foreground'>
					Model
				</label>
				{provider.customModels ? (
					<>
						<Input
							id='decision-model-id'
							list='decision-model-ids'
							placeholder='Model ID'
							value={draft.modelId}
							disabled={isDisabled}
							onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
							onBlur={() => saveModel({ ...draft, modelId: draft.modelId.trim() })}
							onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
						/>
						<datalist id='decision-model-ids'>
							{provider.models.map((known) => (
								<option key={known.id} value={known.id}>
									{known.name}
								</option>
							))}
						</datalist>
					</>
				) : (
					<Select
						value={draft.modelId}
						onValueChange={(modelId) => saveModel({ ...draft, modelId })}
						disabled={isDisabled}
					>
						<SelectTrigger id='decision-model-id' className='w-full'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{provider.models.map((known) => (
								<SelectItem key={known.id} value={known.id}>
									{known.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>
		</div>
	);
}

function DecisionModelTest({ model }: { model: DecisionModel }) {
	const [state, setState] = useState('Checkout has been failing for every customer for the last hour.');
	const [question, setQuestion] = useState('Is this request urgent?');
	const test = useMutation(trpc.decision.test.mutationOptions());

	return (
		<SettingsCard
			title='Test'
			description={`Ask ${model.modelId} a yes/no question about a text to check that it answers.`}
		>
			<div className='grid gap-3'>
				<Textarea value={state} onChange={(event) => setState(event.target.value)} rows={3} />
				<div className='flex gap-2'>
					<Input value={question} onChange={(event) => setQuestion(event.target.value)} />
					<Button
						variant='outline'
						onClick={() => test.mutate({ model, state, question })}
						disabled={test.isPending || !state.trim() || !question.trim()}
					>
						{test.isPending ? <Loader2 className='size-3.5 animate-spin' /> : <Play className='size-3.5' />}
						Ask
					</Button>
				</div>

				{test.data && (
					<p className='rounded-md border px-3 py-2 text-sm'>
						<span className='font-medium'>{test.data.value ? 'Yes' : 'No'}</span>
						<span className='text-muted-foreground'>
							{' '}
							· {Math.round(test.data.probability * 100)}% probability of yes · {test.data.durationMs} ms
							{test.data.model && ` · ${test.data.model}`}
						</span>
					</p>
				)}
				{test.error && (
					<p className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
						{test.error.message}
					</p>
				)}
			</div>
		</SettingsCard>
	);
}
