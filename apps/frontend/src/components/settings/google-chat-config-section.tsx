import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { GoogleChatForm } from './google-chat-form';
import type { inferRouterOutputs } from '@trpc/server';
import type { GoogleChatFormValues } from './google-chat-form';
import type { TrpcRouter } from '@nao/backend/trpc';
import { Button } from '@/components/ui/button';
import { CopyableUrl } from '@/components/ui/copyable-url';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface GoogleChatConfigSectionProps {
	isAdmin: boolean;
	onCancelSetup: () => void;
}

type ProjectRouterOutputs = inferRouterOutputs<TrpcRouter>['project'];
type AvailableModel = ProjectRouterOutputs['listAvailableTranscribeModels'][number];
type ProjectConfig = NonNullable<ProjectRouterOutputs['getGoogleChatConfig']['projectConfig']>;
type ModelSelection = NonNullable<ProjectConfig['modelSelection']>;

const PROJECT_DEFAULT_MODEL_KEY = 'project-default';

export function GoogleChatConfigSection({ isAdmin, onCancelSetup }: GoogleChatConfigSectionProps) {
	const queryClient = useQueryClient();
	const googleChatConfig = useQuery(trpc.project.getGoogleChatConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);

	const projectConfig = googleChatConfig.data?.projectConfig;
	const webhookUrl = googleChatConfig.data?.webhookUrl ?? '';

	const upsertGoogleChatConfig = useMutation(trpc.project.upsertGoogleChatConfig.mutationOptions());
	const updateGoogleChatModel = useMutation(trpc.project.updateGoogleChatModelConfig.mutationOptions());
	const deleteGoogleChatConfig = useMutation(trpc.project.deleteGoogleChatConfig.mutationOptions());

	const handleSubmit = async (values: GoogleChatFormValues) => {
		await upsertGoogleChatConfig.mutateAsync({
			...values,
			modelProvider: projectConfig?.modelSelection?.provider,
			modelId: projectConfig?.modelSelection?.modelId,
		});
		queryClient.invalidateQueries(trpc.project.getGoogleChatConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteGoogleChatConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getGoogleChatConfig.queryOptions());
	};

	const handleCancel = () => {
		if (projectConfig) {
			setIsEditing(false);
			return;
		}
		onCancelSetup();
	};

	const handleStartEditing = () => {
		setIsEditing(true);
	};

	const handleModelChange = async (model: ModelSelection | null) => {
		await updateGoogleChatModel.mutateAsync({ modelProvider: model?.provider, modelId: model?.modelId });
		queryClient.invalidateQueries(trpc.project.getGoogleChatConfig.queryOptions());
	};

	if (!isAdmin) {
		return (
			<SettingsCard title='Connection' description='Your Google Chat app credentials'>
				{projectConfig ? (
					<GoogleChatConnectionDetails projectConfig={projectConfig} />
				) : (
					<p className='text-sm text-muted-foreground'>
						No Google Chat integration configured. Contact an admin to set it up.
					</p>
				)}
			</SettingsCard>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<GoogleChatForm
				hasProjectConfig={!!projectConfig}
				initialProjectNumber={projectConfig?.googleCloudProjectNumber ?? ''}
				onSubmit={handleSubmit}
				onCancel={handleCancel}
				isPending={upsertGoogleChatConfig.isPending}
			/>
		);
	}

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard title='Connection' description='Your Google Chat app credentials'>
				<div className='flex items-center gap-4'>
					<div className='flex-1'>
						<GoogleChatConnectionDetails projectConfig={projectConfig} />
					</div>
					<div className='flex gap-1'>
						<Button variant='ghost' size='icon-sm' onClick={handleStartEditing}>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						<Button
							variant='ghost'
							size='icon-sm'
							onClick={handleDelete}
							disabled={deleteGoogleChatConfig.isPending}
						>
							<Trash2 className='size-4 text-destructive' />
						</Button>
					</div>
				</div>
			</SettingsCard>

			{webhookUrl && (
				<SettingsCard
					title='HTTP Endpoint URL'
					description='Set this URL as the app URL in the Google Chat API configuration'
				>
					<CopyableUrl url={webhookUrl} />
				</SettingsCard>
			)}

			<SettingsCard title='Settings' description='Configure how the Google Chat app behaves'>
				<div className='grid gap-2'>
					<label className='text-sm font-medium text-foreground'>Model</label>
					<p className='text-xs text-muted-foreground'>
						The model used to answer questions asked in Google Chat.
					</p>
					<ModelSelect
						availableModels={availableModels ?? []}
						persistedModel={projectConfig.modelSelection ?? null}
						onChange={handleModelChange}
						disabled={updateGoogleChatModel.isPending}
					/>
				</div>
			</SettingsCard>
		</div>
	);
}

function GoogleChatConnectionDetails({ projectConfig }: { projectConfig: ProjectConfig }) {
	return (
		<div className='grid gap-1'>
			<span className='text-sm font-medium text-foreground'>Google Chat App</span>
			<span className='text-xs font-mono text-muted-foreground'>
				Service account: {projectConfig.serviceAccountEmail}
			</span>
			{projectConfig.googleCloudProjectNumber && (
				<span className='text-xs font-mono text-muted-foreground'>
					Project number: {projectConfig.googleCloudProjectNumber}
				</span>
			)}
		</div>
	);
}

interface ModelSelectProps {
	availableModels: AvailableModel[];
	persistedModel: ModelSelection | null;
	onChange: (model: ModelSelection | null) => Promise<void>;
	disabled: boolean;
}

/** An unpinned integration answers with the project's default chat model, so that is offered as its own choice. */
function ModelSelect({ availableModels, persistedModel, onChange, disabled }: ModelSelectProps) {
	const persistedKey = persistedModel ? toModelKey(persistedModel) : PROJECT_DEFAULT_MODEL_KEY;
	const persistedAvailableModel = availableModels.find((model) => toModelKey(model) === persistedKey);

	const handleValueChange = async (value: string) => {
		if (value === PROJECT_DEFAULT_MODEL_KEY) {
			await onChange(null);
			return;
		}
		const model = availableModels.find((candidate) => toModelKey(candidate) === value);
		if (model) {
			await onChange({ provider: model.provider, modelId: model.modelId });
		}
	};

	return (
		<Select value={persistedKey} onValueChange={handleValueChange} disabled={disabled}>
			<SelectTrigger className='w-full'>
				<SelectValue>
					<div className='flex items-center gap-2'>
						{persistedAvailableModel ? (
							<ModelLabel model={persistedAvailableModel} />
						) : persistedModel ? (
							<span>{persistedModel.modelId} (no longer available)</span>
						) : (
							<span>Project default</span>
						)}
					</div>
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={PROJECT_DEFAULT_MODEL_KEY}>Project default</SelectItem>
				{availableModels.map((model) => (
					<SelectItem key={toModelKey(model)} value={toModelKey(model)}>
						<ModelLabel model={model} />
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function ModelLabel({ model }: { model: AvailableModel }) {
	return (
		<>
			<LlmProviderIcon provider={model.provider} baseUrl={model.baseUrl} className='size-4' />
			<span>{model.name}</span>
		</>
	);
}

function toModelKey(model: { provider: string; modelId: string }): string {
	return `${model.provider}:${model.modelId}`;
}
