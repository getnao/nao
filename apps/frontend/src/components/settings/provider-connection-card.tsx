import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';

interface ProviderConnectionCardProps {
	providerLabel: string;
	icon: ComponentType<{ className?: string }>;
	connectHref: string;
	description?: string;
	connected: boolean;
	username?: string;
	avatarUrl?: string | null;
	onDisconnect: () => void;
	disconnectPending: boolean;
	connectDisabledReason?: string;
}

interface ConnectedProviderAccountProps {
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
	description = `Connect the ${providerLabel} account automations can use for proactive actions.`,
	connected,
	username,
	avatarUrl,
	onDisconnect,
	disconnectPending,
	connectDisabledReason,
}: ProviderConnectionCardProps) {
	return (
		<SettingsCard title={providerLabel} description={description} icon={<Icon className='size-4' />}>
			{connected ? (
				<ConnectedProviderAccount
					username={username}
					avatarUrl={avatarUrl}
					onDisconnect={onDisconnect}
					disconnectPending={disconnectPending}
				/>
			) : (
				<div className='flex flex-col gap-2'>
					<div className='flex items-center justify-between gap-4'>
						<p className='text-sm text-muted-foreground'>{providerLabel} is not connected yet.</p>
						{connectDisabledReason ? (
							<Button variant='secondary' size='sm' disabled>
								<Icon className='size-3.5' />
								Connect {providerLabel}
							</Button>
						) : (
							<Button variant='secondary' size='sm' asChild>
								<a href={connectHref}>
									<Icon className='size-3.5' />
									Connect {providerLabel}
								</a>
							</Button>
						)}
					</div>
					{connectDisabledReason && <p className='text-xs text-muted-foreground'>{connectDisabledReason}</p>}
				</div>
			)}
		</SettingsCard>
	);
}

export function ConnectedProviderAccount({
	username,
	avatarUrl,
	onDisconnect,
	disconnectPending,
}: ConnectedProviderAccountProps) {
	return (
		<div className='flex min-w-0 items-center justify-between gap-4'>
			<div className='flex min-w-0 items-center gap-3'>
				{avatarUrl && <img src={avatarUrl} alt='' className='size-8 rounded-full' />}
				<div className='min-w-0'>
					<div className='truncate text-sm font-medium'>{username}</div>
					<div className='text-xs text-muted-foreground'>Connected</div>
				</div>
			</div>
			<Button variant='secondary' size='sm' onClick={onDisconnect} disabled={disconnectPending}>
				Disconnect
			</Button>
		</div>
	);
}
