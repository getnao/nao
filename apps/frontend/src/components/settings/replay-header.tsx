import { Check, Link } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ReplayCrumb } from '@/components/settings/replay-breadcrumb';
import { ReplayBreadcrumb } from '@/components/settings/replay-breadcrumb';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

/** The fixed-height bar every replay page shares: where the admin is on the left, actions on the right. */
export function ReplayHeader({ crumbs, children }: { crumbs: ReplayCrumb[]; children?: ReactNode }) {
	return (
		<div className='flex h-12 shrink-0 items-center justify-between gap-4 px-4 border-b min-w-0'>
			<ReplayBreadcrumb crumbs={crumbs} />
			{children && <div className='flex shrink-0 items-center gap-1'>{children}</div>}
		</div>
	);
}

export function ReplayIconButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full text-muted-foreground hover:text-foreground'
					onClick={onClick}
					aria-label={label}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

export function CopyReplayLinkButton() {
	const { isCopied, copy } = useCopyToClipboard();
	return (
		<ReplayIconButton
			label={isCopied ? 'Copied!' : 'Copy link'}
			onClick={() => copy(window.location.href).catch(console.error)}
		>
			{isCopied ? <Check className='size-3.5' /> : <Link className='size-3.5' />}
		</ReplayIconButton>
	);
}
