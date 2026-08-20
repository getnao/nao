import { Link } from '@tanstack/react-router';
import { ArrowRight, Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UpgradeBannerProps {
	feature: string;
	description: string;
	className?: string;
}

export function UpgradeBanner({ feature, description, className }: UpgradeBannerProps) {
	return (
		<div
			className={cn(
				'flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center',
				className,
			)}
		>
			<div className='flex min-w-0 flex-1 items-start gap-3'>
				<div className='shrink-0 rounded-full bg-primary/10 p-2 text-primary'>
					<Lock className='size-4' />
				</div>
				<div className='min-w-0'>
					<p className='font-semibold text-foreground'>{feature} is an Enterprise feature</p>
					<p className='mt-1 text-sm text-muted-foreground'>{description}</p>
				</div>
			</div>
			<Button variant='outline' size='sm' className='self-start bg-background sm:self-auto' asChild>
				<Link to='/settings/enterprise'>
					See Enterprise
					<ArrowRight className='size-3.5' />
				</Link>
			</Button>
		</div>
	);
}
