import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

interface UpgradeToEnterpriseProps {
	className?: string;
	iconOnly?: boolean;
}

export function UpgradeToEnterprise({ className, iconOnly = false }: UpgradeToEnterpriseProps) {
	return (
		<Link
			to='/settings/enterprise'
			aria-label='Upgrade to Enterprise'
			title='Upgrade to Enterprise'
			className={cn(
				'inline-flex w-fit shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
				iconOnly ? 'p-1' : 'h-4 gap-0.5 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide',
				className,
			)}
		>
			{iconOnly ? (
				<Lock className='size-3' />
			) : (
				<>
					<Lock className='size-2.5 shrink-0' />
					Enterprise
				</>
			)}
		</Link>
	);
}
