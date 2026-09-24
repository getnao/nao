import { useQuery } from '@tanstack/react-query';
import { Globe, ShieldCheck, Star, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePermissions } from '@/hooks/use-permissions';
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
