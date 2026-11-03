import { useEffect, useState } from 'react';
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

export function GoogleChatConfigSection({ isAdmin, onCancelSetup }: GoogleChatConfigSectionProps) {
	const queryClient = useQueryClient();
	const googleChatConfig = useQuery(trpc.project.getGoogleChatConfig.queryOptions());
	const { data: availableModels } = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());

	const [isEditing, setIsEditing] = useState(false);
	const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);

	const projectConfig = googleChatConfig.data?.projectConfig;
	const webhookUrl = googleChatConfig.data?.webhookUrl ?? '';

	useEffect(() => {
		setSelectedModel(findPersistedModel(availableModels, projectConfig));
	}, [availableModels, projectConfig]);

	const upsertGoogleChatConfig = useMutation(trpc.project.upsertGoogleChatConfig.mutationOptions());
	const updateGoogleChatModel = useMutation(trpc.project.updateGoogleChatModelConfig.mutationOptions());
	const deleteGoogleChatConfig = useMutation(trpc.project.deleteGoogleChatConfig.mutationOptions());

	const handleSubmit = async (values: GoogleChatFormValues) => {
		await upsertGoogleChatConfig.mutateAsync({
			...values,
			modelProvider: selectedModel?.provider,
			modelId: selectedModel?.modelId,
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
		setSelectedModel(findPersistedModel(availableModels, projectConfig));
		setIsEditing(true);
	};

	const handleModelChange = async (model: AvailableModel) => {
		await updateGoogleChatModel.mutateAsync({ modelProvider: model.provider, modelId: model.modelId });
		setSelectedModel(model);
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
						selectedModel={selectedModel}
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
	selectedModel: AvailableModel | null;
	onChange: (model: AvailableModel) => Promise<void>;
	disabled: boolean;
}

function ModelSelect({ availableModels, selectedModel, onChange, disabled }: ModelSelectProps) {
	if (availableModels.length <= 1) {
		return selectedModel ? (
			<div className='flex items-center gap-2 text-sm text-muted-foreground'>
				<ModelLabel model={selectedModel} />
			</div>
		) : null;
	}

	const handleValueChange = async (value: string) => {
		const model = availableModels.find((candidate) => toModelKey(candidate) === value);
		if (model) {
			await onChange(model);
		}
	};

	return (
		<Select
			value={selectedModel ? toModelKey(selectedModel) : undefined}
			onValueChange={handleValueChange}
			disabled={disabled}
		>
			<SelectTrigger className='w-full'>
				<SelectValue>
					{selectedModel && (
						<div className='flex items-center gap-2'>
							<ModelLabel model={selectedModel} />
						</div>
					)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
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

function findPersistedModel(
	availableModels: AvailableModel[] | undefined,
	projectConfig: ProjectConfig | null | undefined,
): AvailableModel | null {
	if (!availableModels || availableModels.length === 0) {
		return null;
	}
	const persisted = projectConfig?.modelSelection;
	const match = persisted && availableModels.find((model) => toModelKey(model) === toModelKey(persisted));
	return match || availableModels[0];
}
