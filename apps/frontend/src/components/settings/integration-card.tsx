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
	connectUrl?: string;
}

export function IntegrationCard({ id, name, icon: Icon, connected, summary, connectUrl }: IntegrationCardProps) {
	return (
		<div className='relative flex items-start gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:bg-accent/50'>
			{connectUrl && !connected ? (
				<a
					href={connectUrl}
					target='_blank'
					rel='noopener noreferrer'
					aria-label={`Connect ${name}`}
					className='absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
				/>
			) : (
				<Link
					to='/settings/project/integrations/$integrationId'
					params={{ integrationId: id }}
					aria-label={`Open ${name} integration settings`}
					className='absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
				/>
			)}
			<Icon className='size-8 shrink-0' />
			<div className='min-w-0 flex-1'>
				<div className='flex flex-wrap items-center gap-2'>
					<h3 className='font-semibold text-foreground'>{name}</h3>
					<IntegrationStatusBadge connected={connected} />
				</div>
				<p className='mt-1 truncate text-sm text-muted-foreground'>{summary}</p>
			</div>
			{connectUrl && !connected ? (
				<a
					href={connectUrl}
					target='_blank'
					rel='noopener noreferrer'
					className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'relative z-10')}
				>
					Connect
				</a>
			) : (
				<Link
					to='/settings/project/integrations/$integrationId'
					params={{ integrationId: id }}
					className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'relative z-10')}
				>
					{connected ? 'Manage' : 'Connect'}
				</Link>
			)}
		</div>
	);
}

export function IntegrationStatusBadge({ connected }: { connected: boolean }) {
	if (connected) {
		return <Badge variant='success'>Connected</Badge>;
	}

	return <Badge variant='secondary'>Not set up</Badge>;
}
