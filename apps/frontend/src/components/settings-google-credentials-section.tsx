import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

interface GoogleConfigSectionProps {
	isAdmin: boolean;
}

export function GoogleConfigSection({ isAdmin }: GoogleConfigSectionProps) {
	const googleSettings = useQuery(trpc.google.getSettings.queryOptions());

	const maskCredential = (value: string) => {
		if (!value) {
			return '';
		}
		if (value.length <= 8) {
			return '••••••••';
		}
		return `${value.slice(0, 4)}••••${value.slice(-4)}`;
	};

	return (
		<div className='grid gap-4'>
			{isAdmin && (
				<button type='button' className='w-full text-left'>
					<div className='flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors'>
						<div className='flex-1 grid gap-1'>
							<div className='flex items-center gap-2'>
								<span className='text-sm font-medium text-foreground'>Google OAuth</span>
								<span className='text-xs text-muted-foreground'>(Override Env)</span>
							</div>
							<div className='grid gap-0.5'>
								<span className='text-xs font-mono text-muted-foreground'>
									Client ID: {maskCredential(googleSettings.data?.clientId || '')}
								</span>
								{googleSettings.data?.authDomains && (
									<span className='text-xs text-muted-foreground'>
										Domains: {googleSettings.data.authDomains}
									</span>
								)}
							</div>
						</div>
						<span className='px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground'>
							ENV
						</span>
					</div>
				</button>
			)}

			{!isAdmin && (
				<p className='text-sm text-muted-foreground'>Contact your admin to update Google OAuth settings.</p>
			)}
		</div>
	);
}
