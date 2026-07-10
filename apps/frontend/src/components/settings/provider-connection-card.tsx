import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';

interface ProviderConnectionCardProps {
	providerLabel: string;
	icon: ComponentType<{ className?: string }>;
	connectHref: string;
	connected: boolean;
	username?: string;
	avatarUrl?: string | null;
	onDisconnect: () => void;
	disconnectPending: boolean;
}

/**
 * Card for connecting/disconnecting a git provider account (GitHub, GitLab, ...) used for
 * automations. Kept provider-agnostic so status/avatar/connect/disconnect UX can't drift
 * between providers.
 */
export function ProviderConnectionCard({
	providerLabel,
	icon: Icon,
	connectHref,
	connected,
	username,
	avatarUrl,
	onDisconnect,
	disconnectPending,
}: ProviderConnectionCardProps) {
	return (
		<SettingsCard
			title={providerLabel}
			description={`Connect the ${providerLabel} account automations can use for proactive actions.`}
			icon={<Icon className='size-4' />}
		>
			{connected ? (
				<div className='flex items-center justify-between gap-4'>
					<div className='flex items-center gap-3 min-w-0'>
						{avatarUrl && <img src={avatarUrl} alt='' className='size-8 rounded-full' />}
						<div className='min-w-0'>
							<div className='text-sm font-medium truncate'>{username}</div>
							<div className='text-xs text-muted-foreground'>Connected</div>
						</div>
					</div>
					<Button variant='secondary' size='sm' onClick={onDisconnect} disabled={disconnectPending}>
						Disconnect
					</Button>
				</div>
			) : (
				<div className='flex items-center justify-between gap-4'>
					<p className='text-sm text-muted-foreground'>{providerLabel} is not connected yet.</p>
					<Button variant='secondary' size='sm' asChild>
						<a href={connectHref}>
							<Icon className='size-3.5' />
							Connect {providerLabel}
						</a>
					</Button>
				</div>
			)}
		</SettingsCard>
	);
}
