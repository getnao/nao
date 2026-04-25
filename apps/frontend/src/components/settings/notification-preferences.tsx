import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENT_LABELS, NOTIFICATION_EVENT_TYPES } from '@nao/shared/types';
import type { NotificationChannel, NotificationEventType } from '@nao/shared/types';

import { Switch } from '@/components/ui/switch';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { trpc, trpcClient } from '@/main';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
	in_app: 'In-App',
	email: 'Email',
};

export function NotificationPreferences() {
	const queryClient = useQueryClient();
	const preferences = useQuery(trpc.notification.getPreferences.queryOptions());

	const isEnabled = (event: NotificationEventType, channel: NotificationChannel): boolean => {
		if (!preferences.data) {
			return true;
		} // Default enabled
		const pref = preferences.data.find((p) => p.event === event && p.channel === channel);
		return pref ? pref.enabled : true; // Default enabled if no explicit pref
	};

	const handleToggle = async (event: NotificationEventType, channel: NotificationChannel, enabled: boolean) => {
		await trpcClient.notification.setPreference.mutate({ event, channel, enabled });
		queryClient.invalidateQueries({ queryKey: trpc.notification.getPreferences.queryKey() });
	};

	return (
		<SettingsPageWrapper>
			<SettingsCard
				icon={<Bell className='size-4' />}
				title='Notification Preferences'
				titleSize='lg'
				description='Configure how and when you receive notifications'
			>
				{/* Header row */}
				<div className='grid grid-cols-[1fr_80px_80px] gap-2 items-center px-1 pb-2 border-b border-border'>
					<span className='text-xs font-medium text-muted-foreground uppercase tracking-wider'>Event</span>
					{NOTIFICATION_CHANNELS.map((channel) => (
						<span
							key={channel}
							className='text-xs font-medium text-muted-foreground uppercase tracking-wider text-center'
						>
							{CHANNEL_LABELS[channel]}
						</span>
					))}
				</div>

				{/* Event rows */}
				{NOTIFICATION_EVENT_TYPES.map((event) => (
					<div key={event} className='grid grid-cols-[1fr_80px_80px] gap-2 items-center px-1 py-1.5'>
						<div>
							<span className='text-sm text-foreground'>{NOTIFICATION_EVENT_LABELS[event]}</span>
						</div>
						{NOTIFICATION_CHANNELS.map((channel) => (
							<div key={channel} className='flex justify-center'>
								<Switch
									id={`notif-${event}-${channel}`}
									checked={isEnabled(event, channel)}
									onCheckedChange={(checked) => handleToggle(event, channel, checked)}
									disabled={preferences.isLoading}
								/>
							</div>
						))}
					</div>
				))}
			</SettingsCard>
		</SettingsPageWrapper>
	);
}
