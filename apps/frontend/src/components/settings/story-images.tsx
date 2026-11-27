import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { normalizeStoryImageAllowedSource, STORY_IMAGE_SOURCE_FORMAT_MESSAGE } from '@nao/shared/story-image';

import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface SettingsStoryImagesProps {
	isAdmin: boolean;
}

export function SettingsStoryImages({ isAdmin }: SettingsStoryImagesProps) {
	const queryClient = useQueryClient();
	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const updateAgentSettings = useMutation(
		trpc.project.updateAgentSettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.project.getAgentSettings.queryOptions().queryKey });
			},
		}),
	);
	const [isAdding, setIsAdding] = useState(false);
	const [draft, setDraft] = useState('');
	const [draftError, setDraftError] = useState<string | null>(null);

	const sources = agentSettings.data?.storyImages?.allowedSources ?? [];
	const error = draftError ?? updateAgentSettings.error?.message;

	const save = (allowedSources: string[]) => {
		updateAgentSettings.mutate({ storyImages: { allowedSources } });
	};

	const closeDraft = () => {
		setIsAdding(false);
		setDraft('');
		setDraftError(null);
	};

	const addDraft = () => {
		const source = normalizeStoryImageAllowedSource(draft);
		if (!source) {
			setDraftError(STORY_IMAGE_SOURCE_FORMAT_MESSAGE);
			return;
		}
		closeDraft();
		if (!sources.includes(source)) {
			save([...sources, source]);
		}
	};

	return (
		<SettingsCard
			title='Story images'
			description='Sources custom stories may show images from. nao reads gs:// and s3:// links with its own cloud credentials and fetches https:// images itself, so viewers never need access to the bucket. Anyone who can open a story, including through a share link, can see any image under these sources.'
			action={
				isAdmin && (
					<Button variant='secondary' size='sm' onClick={() => setIsAdding(true)} disabled={isAdding}>
						<Plus className='size-4' />
						Add
					</Button>
				)
			}
		>
			<div className='flex flex-col gap-4'>
				{isAdding && (
					<div className='flex flex-col gap-2'>
						<Input
							autoFocus
							value={draft}
							onChange={(e) => {
								setDraft(e.target.value);
								setDraftError(null);
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addDraft();
								}
								if (e.key === 'Escape') {
									closeDraft();
								}
							}}
							placeholder='gs://bucket/folder or https://cdn.example.com'
							className='font-mono'
							disabled={updateAgentSettings.isPending}
						/>
						<div className='flex justify-end gap-2'>
							<Button variant='ghost' size='sm' onClick={closeDraft}>
								Cancel
							</Button>
							<Button
								size='sm'
								onClick={addDraft}
								disabled={!draft.trim() || updateAgentSettings.isPending}
							>
								Add source
							</Button>
						</div>
					</div>
				)}
				{error && <p className='text-sm text-destructive'>{error}</p>}

				<div className='flex flex-wrap gap-2'>
					{sources.length === 0 && !isAdding && (
						<Empty className='w-full'>
							{isAdmin
								? 'No image sources yet: stories cannot show any image.'
								: 'No image sources yet. Contact your admin to allow some.'}
						</Empty>
					)}
					{sources.map((source) => (
						<span
							key={source}
							className={cn(
								'flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-3 font-mono text-sm',
								isAdmin ? 'pr-1.5' : 'pr-3',
							)}
						>
							{source}
							{isAdmin && (
								<button
									type='button'
									onClick={() => save(sources.filter((entry) => entry !== source))}
									disabled={updateAgentSettings.isPending}
									className='rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
									aria-label={`Remove ${source}`}
								>
									<X className='size-3.5' />
								</button>
							)}
						</span>
					))}
				</div>
			</div>
		</SettingsCard>
	);
}
