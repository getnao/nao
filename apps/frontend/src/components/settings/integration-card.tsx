import { Link } from '@tanstack/react-router';
import type { ComponentType } from 'react';

import type { IntegrationId } from '@/components/settings/integrations';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface IntegrationCardProps {
	id: IntegrationId;
	name: string;
	icon: ComponentType<{ className?: string }>;
	connected: boolean;
	summary: string;
}

export function IntegrationCard({ id, name, icon: Icon, connected, summary }: IntegrationCardProps) {
	return (
		<Link
			to='/settings/project/integrations/$integrationId'
			params={{ integrationId: id }}
			className='flex items-start gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-accent/50'
		>
			<Icon className='size-8 shrink-0' />
			<div className='min-w-0 flex-1'>
				<div className='flex flex-wrap items-center gap-2'>
					<h3 className='font-semibold text-foreground'>{name}</h3>
					<IntegrationStatusBadge connected={connected} />
				</div>
				<p className='mt-1 truncate text-sm text-muted-foreground'>{summary}</p>
			</div>
			<span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none')}>
				{connected ? 'Manage' : 'Connect'}
			</span>
		</Link>
	);
}

export function IntegrationStatusBadge({ connected }: { connected: boolean }) {
	if (connected) {
		return <Badge variant='success'>Connected</Badge>;
	}

	return <Badge variant='secondary'>Not set up</Badge>;
}
