import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, hideIf } from '@/lib/utils';
import { trpc } from '@/main';

interface SidebarVersionNoticeProps {
	isCollapsed: boolean;
}

export function SidebarVersionNotice({ isCollapsed }: SidebarVersionNoticeProps) {
	const { data } = useQuery({
		...trpc.system.checkUpdate.queryOptions(),
		staleTime: 60 * 60 * 1000,
		retry: false,
	});

	if (!data?.updateAvailable || !data.latestVersion) {
		return null;
	}

	const label = `v${data.latestVersion} available`;

	if (isCollapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<div className='flex items-center justify-center p-2 mb-1 rounded-md text-amber-500'>
						<TriangleAlert className='size-4' />
					</div>
				</TooltipTrigger>
				<TooltipContent side='right'>{label}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<a
			href={`https://github.com/getnao/nao/releases/tag/v${data.latestVersion}`}
			target='_blank'
			rel='noopener noreferrer'
			className='flex items-center gap-2 px-3 py-2 mb-1 rounded-md text-xs text-amber-500 hover:bg-sidebar-accent transition-colors'
		>
			<TriangleAlert className='size-3.5 shrink-0' />
			<span className={cn('truncate transition-[opacity,visibility] duration-300', hideIf(isCollapsed))}>
				{label}
			</span>
		</a>
	);
}
