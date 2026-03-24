import { cn } from '@/lib/utils';
import GithubIcon from '@/components/icons/github-icon.svg';
import SlackIcon from '@/components/icons/slack.svg';

interface SidebarCommunityProps {
	isCollapsed: boolean;
}

export function SidebarCommunity({ isCollapsed }: SidebarCommunityProps) {
	if (isCollapsed) {
		return null;
	}

	return (
		<div className='flex items-center px-4 pb-3'>
			<span className='text-[10px] uppercase tracking-widest text-muted-foreground/30 font-medium mr-auto'>
				Community
			</span>
			<div className='flex items-center gap-0.5'>
				<a
					href='https://github.com/getnao/nao'
					target='_blank'
					rel='noopener noreferrer'
					className={cn(
						'p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-sidebar-accent transition-colors',
					)}
					title='GitHub'
				>
					<GithubIcon className='size-3.5' />
				</a>
				<a
					href='https://join.slack.com/t/naolabs/shared_invite/zt-3cgdql4up-Az9FxGkTb8Qr34z2Dxp9TQ'
					target='_blank'
					rel='noopener noreferrer'
					className={cn(
						'p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-sidebar-accent transition-colors',
					)}
					title='Join Slack'
				>
					<SlackIcon className='size-3.5 grayscale brightness-0 dark:brightness-200 opacity-30' />
				</a>
			</div>
		</div>
	);
}
