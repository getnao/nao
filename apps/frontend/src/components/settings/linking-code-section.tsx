import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, RefreshCcw, Unlink } from 'lucide-react';
import { SettingsCard } from '../ui/settings-card';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

type MessagingProvider = 'whatsapp' | 'telegram';

interface LinkingCodesCardProps {
	provider: MessagingProvider;
}

const PROVIDER_LABELS: Record<MessagingProvider, { name: string; loginHint: string; setupHint: string }> = {
	whatsapp: {
		name: 'WhatsApp',
		loginHint: 'Send `/login <code>` from the WhatsApp number you want to link.',
		setupHint: 'An admin still needs to finish the WhatsApp app setup.',
	},
	telegram: {
		name: 'Telegram',
		loginHint: 'Send `/login <code>` to the Telegram bot you want to link.',
		setupHint: 'An admin still needs to finish the Telegram bot setup.',
	},
};

export function LinkingCodesCard({ provider }: LinkingCodesCardProps) {
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const user = session?.user;
	const labels = PROVIDER_LABELS[provider];

	const whatsappConfig = useQuery({
		...trpc.project.getWhatsappConfig.queryOptions(),
		enabled: provider === 'whatsapp',
	});
	const telegramConfig = useQuery({
		...trpc.project.getTelegramConfig.queryOptions(),
		enabled: provider === 'telegram',
	});
	const currentCode = useQuery(trpc.project.getCurrentUserMessagingProviderCode.queryOptions());
	const linkedAccounts = useQuery({
		...trpc.project.getCurrentUserWhatsappLinks.queryOptions(),
		enabled: provider === 'whatsapp',
	});
	const regenerateCode = useMutation(trpc.project.regenerateCurrentUserMessagingProviderCode.mutationOptions());
	const unlinkWhatsapp = useMutation(trpc.project.unlinkCurrentUserWhatsappLink.mutationOptions());

	const configQuery = provider === 'whatsapp' ? whatsappConfig : telegramConfig;
	const isConfigured = Boolean(configQuery.data?.projectConfig);
	const code = currentCode.data ?? '';
	const [copied, setCopied] = useState(false);

	const handleRegenerate = async () => {
		await regenerateCode.mutateAsync();
		await queryClient.invalidateQueries(trpc.project.getCurrentUserMessagingProviderCode.queryOptions());
	};

	const handleRegenerateRef = useRef(handleRegenerate);
	handleRegenerateRef.current = handleRegenerate;

	useEffect(() => {
		if (!user?.id || currentCode.isLoading || regenerateCode.isPending) {
			return;
		}

		if (!currentCode.data) {
			handleRegenerateRef.current().catch(console.error);
		}

		const interval = setInterval(() => handleRegenerateRef.current().catch(console.error), 2 * 60 * 1000);
		return () => clearInterval(interval);
	}, [currentCode.data, currentCode.isLoading, regenerateCode.isPending, user?.id]);

	const handleUnlink = async (whatsappUserId: string) => {
		await unlinkWhatsapp.mutateAsync({ whatsappUserId });
		await queryClient.invalidateQueries(trpc.project.getCurrentUserWhatsappLinks.queryOptions());
	};

	const handleCopy = async () => {
		if (!code) {
			return;
		}
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<SettingsCard
			title='Linking Code'
			description={labels.loginHint}
			action={
				<Button
					variant='outline'
					size='sm'
					onClick={() => handleRegenerate().catch(console.error)}
					disabled={regenerateCode.isPending}
				>
					<RefreshCcw className='size-3.5' />
					Refresh code
				</Button>
			}
		>
			<div className='grid gap-3'>
				<div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
					<div className='min-w-0'>
						<p className='text-xs text-muted-foreground'>Email</p>
						<p className='text-sm font-medium text-foreground truncate'>{user?.email ?? 'Loading...'}</p>
					</div>
					<div className='min-w-0 sm:justify-self-end'>
						<p className='text-xs text-muted-foreground'>Code</p>
						{code ? (
							<div className='flex items-center gap-2'>
								<code className='min-w-0 rounded border border-border bg-muted/50 px-2 py-1.5 text-xs font-mono text-foreground'>
									{code}
								</code>
								<Button
									variant='ghost'
									size='icon-sm'
									onClick={() => handleCopy().catch(console.error)}
								>
									{copied ? (
										<Check className='size-3.5 text-green-500' />
									) : (
										<Copy className='size-3.5' />
									)}
								</Button>
							</div>
						) : (
							<div className='flex items-center gap-2 text-xs text-muted-foreground'>
								<Loader2 className='size-3.5 animate-spin' />
								Preparing code...
							</div>
						)}
					</div>
				</div>

				{!configQuery.isLoading && !isConfigured && (
					<p className='text-xs text-muted-foreground'>{labels.setupHint}</p>
				)}

				{provider === 'whatsapp' && (
					<div className='grid gap-2 border-t border-border pt-3'>
						<p className='text-sm font-medium text-foreground'>
							{linkedAccounts.data && linkedAccounts.data.length > 1
								? 'Linked WhatsApp accounts'
								: 'Linked WhatsApp account'}
						</p>
						{linkedAccounts.isLoading ? (
							<div className='flex items-center gap-2 text-xs text-muted-foreground'>
								<Loader2 className='size-3.5 animate-spin' />
								Checking link...
							</div>
						) : linkedAccounts.data?.length ? (
							linkedAccounts.data.map((link) => (
								<div
									key={link.whatsappUserId}
									className='flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between'
								>
									<div className='min-w-0'>
										<p className='text-xs text-muted-foreground'>Currently linked</p>
										<code className='block truncate rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground'>
											{link.whatsappUserId}
										</code>
									</div>
									<Button
										variant='outline'
										size='sm'
										onClick={() => handleUnlink(link.whatsappUserId).catch(console.error)}
										disabled={unlinkWhatsapp.isPending}
									>
										<Unlink className='size-3.5' />
										Unlink
									</Button>
								</div>
							))
						) : (
							<p className='text-xs text-muted-foreground'>No WhatsApp account linked yet.</p>
						)}
					</div>
				)}
			</div>
		</SettingsCard>
	);
}
