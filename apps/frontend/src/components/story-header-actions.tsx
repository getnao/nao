import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CopyPlus, Globe, ShieldCheck, Star, ThumbsDown, ThumbsUp, Upload } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { FeedbackVote } from '@/components/chat-messages/assistant-message-actions';

import { FeedbackDialog } from '@/components/chat-messages/assistant-message-actions';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { useToggleStoryCertification } from '@/hooks/use-toggle-story-certification';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface ShareButtonProps {
	isShared: boolean;
	onShare: () => void;
	disabled?: boolean;
}

export function ShareButton({ isShared, onShare, disabled = false }: ShareButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={onShare}
					disabled={disabled}
					aria-label='Share'
				>
					{isShared ? (
						<Globe className='size-3.5 text-primary' strokeWidth={2.25} />
					) : (
						<Upload className='size-3.5' strokeWidth={2.25} />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>Share</TooltipContent>
		</Tooltip>
	);
}

export function StoryDuplicateMenuItem({ storyId }: { storyId: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: currentProject } = useQuery(trpc.project.getCurrent.queryOptions());
	const switchProject = useProjectSwitch(currentProject?.id);
	const { data: resolvedStory } = useQuery(trpc.story.resolve.queryOptions({ storyId }));
	const duplicateMutation = useMutation(
		trpc.chatFork.forkStory.mutationOptions({
			onSuccess: async ({ chatId }) => {
				if (resolvedStory?.projectId) {
					await switchProject(resolvedStory.projectId);
				}
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: resolvedStory?.slug } });
			},
		}),
	);

	return (
		<DropdownMenuItem
			onSelect={() => duplicateMutation.mutate({ storyId })}
			disabled={!resolvedStory || duplicateMutation.isPending}
		>
			<CopyPlus strokeWidth={2.25} />
			<span>Duplicate</span>
		</DropdownMenuItem>
	);
}

export function StoryFavoriteMenuItem({ storyId }: { storyId: string }) {
	const { isFavorited, toggle, isPending } = useStoryFavorite(storyId);

	return (
		<DropdownMenuItem onSelect={toggle} disabled={isPending}>
			<Star className={cn(isFavorited && 'fill-foreground')} strokeWidth={2.25} />
			<span>{isFavorited ? 'Unfavorite' : 'Favorite'}</span>
		</DropdownMenuItem>
	);
}

export function StoryCertifyMenuItem({ storyId }: { storyId: string }) {
	const { isAdmin } = usePermissions();
	const certification = useQuery({
		...trpc.story.getCertification.queryOptions({ storyId }),
		enabled: isAdmin,
		retry: false,
	});
	const { toggle, isPending } = useToggleStoryCertification();

	if (!isAdmin || !certification.data) {
		return null;
	}

	const { certifiedAt, certifiedByName } = certification.data;
	const isCertified = certifiedAt !== null;

	return (
		<DropdownMenuItem
			onSelect={() => toggle(storyId)}
			disabled={isPending}
			title={isCertified && certifiedByName ? `Certified by ${certifiedByName}` : undefined}
		>
			<ShieldCheck className={cn(isCertified && 'fill-foreground/20')} strokeWidth={2.25} />
			<span>{isCertified ? 'Remove certification' : 'Certify'}</span>
		</DropdownMenuItem>
	);
}

export function StoryFavoritedButton({ storyId }: { storyId: string }) {
	const { isFavorited, toggle, isPending } = useStoryFavorite(storyId);

	if (!isFavorited) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={toggle}
					disabled={isPending}
					aria-label='Unfavorite'
				>
					<Star className='size-3.5 fill-foreground' strokeWidth={2.25} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>Unfavorite</TooltipContent>
		</Tooltip>
	);
}

export function StoryFeedbackButtons({ storyId }: { storyId: string }) {
	const [dialogVote, setDialogVote] = useState<FeedbackVote>('down');
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const { data: feedback } = useQuery(trpc.feedback.getStoryFeedback.queryOptions({ storyId }));
	const submitFeedback = useMutation(
		trpc.feedback.submitStoryFeedback.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.feedback.getStoryFeedback.queryKey({ storyId }), data);
			},
		}),
	);

	const openDialog = (vote: FeedbackVote) => {
		setDialogVote(vote);
		setIsDialogOpen(true);
	};

	const handleSubmit = (explanation?: string) => {
		submitFeedback.mutate({ storyId, vote: dialogVote, explanation });
		setIsDialogOpen(false);
	};

	return (
		<>
			<div className='flex items-center'>
				<StoryFeedbackButton
					Icon={ThumbsUp}
					label='Good story'
					isActive={feedback?.vote === 'up'}
					activeClassName='text-primary'
					disabled={submitFeedback.isPending}
					onClick={() => openDialog('up')}
				/>
				<StoryFeedbackButton
					Icon={ThumbsDown}
					label='Bad story'
					isActive={feedback?.vote === 'down'}
					activeClassName='text-destructive'
					disabled={submitFeedback.isPending}
					onClick={() => openDialog('down')}
				/>
			</div>

			<FeedbackDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				onSubmit={handleSubmit}
				isPending={submitFeedback.isPending}
				vote={dialogVote}
				subject='story'
			/>
		</>
	);
}

interface StoryFeedbackButtonProps {
	Icon: LucideIcon;
	label: string;
	isActive: boolean;
	activeClassName: string;
	disabled: boolean;
	onClick: () => void;
}

function StoryFeedbackButton({ Icon, label, isActive, activeClassName, disabled, onClick }: StoryFeedbackButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className={cn('hover:rounded-full', isActive && activeClassName)}
					onClick={onClick}
					disabled={disabled}
					aria-label={label}
					aria-pressed={isActive}
				>
					<Icon className='size-4' strokeWidth={1.75} />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function useStoryFavorite(storyId: string) {
	const { toggle, isPending } = useToggleFavorite('story');
	const { data: favorites } = useQuery(trpc.favorite.list.queryOptions());
	const isFavorited = favorites?.storyIds.includes(storyId) ?? false;

	return {
		isFavorited,
		isPending,
		toggle: () => {
			toggle(storyId);
		},
	};
}
