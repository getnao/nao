import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { VenetianMask } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { trpc } from '@/main';

export function GroupImpersonationBanner() {
	const impersonation = useQuery(trpc.userGroup.impersonation.queryOptions());
	const refreshPermissions = useRefreshPermissions();
	const navigate = useNavigate();
	const stop = useMutation(
		trpc.userGroup.stopImpersonation.mutationOptions({
			onSuccess: async () => {
				await refreshPermissions();
				await navigate({ to: '/settings/project/user-groups', search: { tab: 'groups' } });
			},
		}),
	);

	if (!impersonation.data) {
		return null;
	}

	const { groupNames } = impersonation.data;
	return (
		<Callout
			variant='warning'
			icon={VenetianMask}
			className='items-center rounded-none border-x-0 border-t-0 px-4 py-2 text-sm'
			role='status'
		>
			<div className='flex min-h-8 flex-wrap items-center gap-3'>
				<div className='min-w-0 flex-1'>
					<span className='font-medium text-foreground'>
						You are impersonating {groupNames.length > 0 ? groupNames.join(', ') : 'the default group only'}
						.
					</span>{' '}
					<span className='text-muted-foreground'>
						You see the app with the permissions of a member of these groups, without admin rights.
					</span>
				</div>
				<Button size='sm' onClick={() => stop.mutate()} disabled={stop.isPending}>
					Stop impersonating
				</Button>
			</div>
		</Callout>
	);
}

export function ImpersonateGroupsButton({ groups }: { groups: Array<{ id: string; name: string }> }) {
	const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
	const refreshPermissions = useRefreshPermissions();
	const navigate = useNavigate();
	const start = useMutation(
		trpc.userGroup.startImpersonation.mutationOptions({
			onSuccess: async () => {
				await navigate({ to: '/' });
				await refreshPermissions();
			},
		}),
	);

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant='secondary'>
					<VenetianMask />
					Impersonate
				</Button>
			</PopoverTrigger>
			<PopoverContent align='end' className='flex flex-col gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Impersonate groups</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Use the app as a member of the selected groups. The default group always applies.
					</p>
				</div>
				<div className='flex max-h-60 flex-col gap-2 overflow-y-auto'>
					{groups.map((group) => (
						<label key={group.id} className='flex cursor-pointer items-center gap-2 text-sm'>
							<Checkbox
								checked={selectedGroupIds.includes(group.id)}
								onCheckedChange={(checked) =>
									setSelectedGroupIds((current) =>
										checked ? [...current, group.id] : current.filter((id) => id !== group.id),
									)
								}
							/>
							{group.name}
						</label>
					))}
				</div>
				{start.error && <p className='text-xs text-destructive'>{start.error.message}</p>}
				<Button
					size='sm'
					onClick={() => start.mutate({ groupIds: selectedGroupIds })}
					disabled={start.isPending}
				>
					Start impersonating
				</Button>
			</PopoverContent>
		</Popover>
	);
}

function useRefreshPermissions() {
	const queryClient = useQueryClient();
	const router = useRouter();

	return async () => {
		await queryClient.invalidateQueries();
		await router.invalidate();
	};
}
