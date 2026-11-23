import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CloudSlackOAuthProps {
	oauthInstallUrl?: string;
}

export function CloudSlackOAuth({ oauthInstallUrl }: CloudSlackOAuthProps) {
	return (
		<div className='flex flex-col gap-4 p-4 rounded-xl border border-border bg-background'>
			<div className='flex items-center gap-3'>
				<div className='grid gap-0.5'>
					<span className='text-sm font-medium text-foreground'>Slack</span>
					<p className='text-xs text-muted-foreground'>
						Bring your nao agent into your Slack workspace. <br /> Slack will ask you to choose a workspace
						and approve nao. There are no app credentials or tokens to copy.
					</p>
				</div>
			</div>

			<div className='flex justify-end'>
				{oauthInstallUrl ? (
					<Button size='sm' variant='primary-gradient' asChild>
						<a href={oauthInstallUrl} target='_blank' rel='noopener noreferrer'>
							Connect to Slack
							<ExternalLink className='size-3.5' />
						</a>
					</Button>
				) : (
					<Button size='sm' variant='primary-gradient' disabled>
						Connect to Slack
					</Button>
				)}
			</div>
		</div>
	);
}
