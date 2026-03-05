import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { SlackForm } from './slack-form';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

interface SlackConfigSectionProps {
	isAdmin: boolean;
}

export function SlackConfigSection({ isAdmin }: SlackConfigSectionProps) {
	const queryClient = useQueryClient();
	const slackConfig = useQuery(trpc.project.getSlackConfig.queryOptions());

	const [isEditing, setIsEditing] = useState(false);

	const upsertSlackConfig = useMutation(trpc.project.upsertSlackConfig.mutationOptions());
	const deleteSlackConfig = useMutation(trpc.project.deleteSlackConfig.mutationOptions());

	const projectId = slackConfig.data?.projectId;
	const projectConfig = slackConfig.data?.projectConfig;
	const redirectUrl = slackConfig.data?.redirectUrl;

	const handleSubmit = async (values: { botToken: string; signingSecret: string }) => {
		await upsertSlackConfig.mutateAsync(values);
		queryClient.invalidateQueries(trpc.project.getSlackConfig.queryOptions());
		setIsEditing(false);
	};

	const handleDelete = async () => {
		await deleteSlackConfig.mutateAsync();
		queryClient.removeQueries(trpc.project.getSlackConfig.queryOptions());
	};

	if (!isAdmin) {
		return (
			<p className='text-sm text-muted-foreground'>
				No Slack integration configured. Contact an admin to set it up.
			</p>
		);
	}

	if (isEditing || !projectConfig) {
		return (
			<SlackForm
				projectId={projectId}
				redirectUrl={redirectUrl}
				hasProjectConfig={!!projectConfig}
				onSubmit={handleSubmit}
				onCancel={() => setIsEditing(false)}
				isPending={upsertSlackConfig.isPending}
			/>
		);
	}

	return (
		<div className='p-4 rounded-lg border border-border bg-muted/30'>
			<div className='flex items-center gap-4'>
				<div className='flex-1 grid gap-0.5'>
					<span className='text-sm font-medium text-foreground'>Slack</span>
					<span className='text-xs font-mono text-muted-foreground'>
						Bot Token: {projectConfig.botTokenPreview}
					</span>
					<span className='text-xs font-mono text-muted-foreground'>
						Signing Secret: {projectConfig.signingSecretPreview}
					</span>
				</div>
				<div className='flex gap-1'>
					<Button variant='ghost' size='icon-sm' onClick={() => setIsEditing(true)}>
						<Pencil className='size-3 text-muted-foreground' />
					</Button>
					<Button
						variant='ghost'
						size='icon-sm'
						onClick={handleDelete}
						disabled={deleteSlackConfig.isPending}
					>
						<Trash2 className='size-4 text-destructive' />
					</Button>
				</div>
			</div>
		</div>
	);
}
