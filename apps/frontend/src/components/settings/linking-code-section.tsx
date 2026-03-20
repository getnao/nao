import { useMutation } from '@tanstack/react-query';
import { useRef, useEffect } from 'react';
import { SettingsCard } from '../ui/settings-card';
import { CopyableUrl } from '../ui/copyable-url';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function LinkingCodesCard() {
	const { data: session, refetch: refetchSession } = useSession();
	const user = session?.user;

	const regenerateCode = useMutation(trpc.project.regenerateMessagingProviderCode.mutationOptions());

	const handleRegenerate = async (userId: string) => {
		await regenerateCode.mutateAsync({ userId });
		await refetchSession();
	};

	const handleRegenerateRef = useRef(handleRegenerate);
	handleRegenerateRef.current = handleRegenerate;

	useEffect(() => {
		if (!user?.id) {
			return;
		}
		const userId = user.id;
		if (!user.messagingProviderCode) {
			handleRegenerateRef.current(userId).catch(console.error);
		}
		const interval = setInterval(() => handleRegenerateRef.current(userId).catch(console.error), 2 * 60 * 1000);
		return () => clearInterval(interval);
	}, [user?.id, user?.messagingProviderCode]);

	return (
		<SettingsCard title='Linking Code'>
			<div className='grid gap-3'>
				<div key={user?.id} className='flex items-center justify-between gap-4'>
					<div className='flex-1 min-w-0'>
						<p className='text-sm font-medium text-foreground truncate'>{user?.name}</p>
						<p className='text-xs text-muted-foreground truncate'>{user?.email}</p>
					</div>
					<div className='flex items-center gap-2'>
						{user?.messagingProviderCode ? (
							<>{user?.messagingProviderCode && <CopyableUrl url={user?.messagingProviderCode} />}</>
						) : (
							<span className='text-xs text-muted-foreground'>No code</span>
						)}
					</div>
				</div>
			</div>
		</SettingsCard>
	);
}
