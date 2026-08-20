import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, Loader2, Mail, Slack } from 'lucide-react';
import type { NotificationChannel } from '@nao/shared/types';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface StorySubscriptionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	storyId: string;
}

type SubscriptionChannel = Extract<NotificationChannel, 'email' | 'slack'>;

const CHANNELS: { id: SubscriptionChannel; label: string; description: string; icon: React.ReactNode }[] = [
	{
		id: 'email',
		label: 'Email',
		description: 'Receive the latest version of this story by email.',
		icon: <Mail className='size-4' />,
	},
	{
		id: 'slack',
		label: 'Slack',
		description: 'Receive the latest version of this story as a Slack message.',
		icon: <Slack className='size-4' />,
	},
];

export function StorySubscriptionDialog({ open, onOpenChange, storyId }: StorySubscriptionDialogProps) {
	const queryClient = useQueryClient();
	const subscription = useQuery({
		...trpc.notification.getStorySubscription.queryOptions({ storyId }),
		enabled: open,
	});

	const setSubscription = useMutation(
		trpc.notification.setStorySubscription.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: trpc.notification.getStorySubscription.queryKey({ storyId }),
				});
			},
		}),
	);

	const handleToggle = (channel: SubscriptionChannel, subscribed: boolean) => {
		setSubscription.mutate({ storyId, channel, subscribed });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader className='gap-4'>
					<DialogTitle>Notifications for this story</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						Choose how you want to be notified when this story is refreshed. You can unsubscribe or
						re-subscribe at any time.
					</DialogDescription>
				</DialogHeader>

				<section className='flex flex-col gap-4'>
					{subscription.isLoading ? (
						<div className='flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground'>
							<Loader2 className='size-4 animate-spin' />
							<span>Loading notification settings…</span>
						</div>
					) : subscription.isError ? (
						<div className='flex flex-col items-center gap-3 py-6 text-center'>
							<p className='text-sm text-muted-foreground'>Couldn't load notification settings.</p>
							<Button
								variant='outline'
								size='sm'
								className='rounded-full'
								onClick={() => void subscription.refetch()}
							>
								Try again
							</Button>
						</div>
					) : (
						CHANNELS.map((channel) => {
							const state = subscription.data?.[channel.id];
							const available = state?.available ?? false;
							return (
								<div key={channel.id} className='flex items-center justify-between gap-4'>
									<div className={cn('flex items-center gap-2.5', !available && 'opacity-50')}>
										<div className='flex size-8 items-center justify-center rounded-full'>
											{channel.icon}
										</div>
										<div className='flex flex-col gap-1'>
											<p className='text-sm font-semibold'>{channel.label}</p>
											<p className='text-xs text-muted-foreground'>
												{available
													? channel.description
													: `This story isn't delivered over ${channel.label}.`}
											</p>
										</div>
									</div>
									<Switch
										aria-label={channel.label}
										checked={state?.subscribed ?? false}
										disabled={!available || setSubscription.isPending}
										onCheckedChange={(next) => handleToggle(channel.id, next)}
									/>
								</div>
							);
						})
					)}
				</section>

				<div className='flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>
					<BellOff className='size-3.5 shrink-0' />
					<span>Turning a channel off stops future refresh notifications for you only.</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
