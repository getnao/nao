import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { cn } from '@/lib/utils';

interface UpgradeToEnterpriseProps {
	className?: string;
}

export function UpgradeToEnterprise({ className }: UpgradeToEnterpriseProps) {
	return (
		<Link
			to='/settings/enterprise'
			aria-label='Upgrade to Enterprise'
			title='Upgrade to Enterprise'
			className={cn(
				'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
				className,
			)}
		>
			<Lock className='size-3' />
			Enterprise
		</Link>
	);
}
