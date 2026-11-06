import { Link } from '@tanstack/react-router';
import { Check, LoaderCircle, Send, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';

import SlackIcon from '@/components/icons/slack.svg';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';

const slackInviteUrl = 'https://join.slack.com/t/naolabs/shared_invite/zt-4080jlm79-nm52x5nZhG2N1ben8zwpiQ';

export function RouteErrorPage({
	error,
	componentStack,
	fullScreen = false,
}: {
	error?: unknown;
	componentStack?: string | null;
	fullScreen?: boolean;
}) {
	const isHomePage = window.location.pathname === '/';
	const pageUrl = window.location.href;
	const errorReport = getErrorReport(error, componentStack);
	const errorDetails = getErrorDetails(errorReport, pageUrl);
	const { copy } = useCopyToClipboard();
	const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'failed'>('idle');

	const handleSlack = async () => {
		if (!errorDetails) {
			window.open(slackInviteUrl, '_blank', 'noopener,noreferrer');
			return;
		}
		setCopyStatus('copying');
		const copyPromise = copy(errorDetails);
		const slackWindow = window.open('about:blank', '_blank');
		if (slackWindow) {
			slackWindow.opener = null;
		}
		try {
			await copyPromise;
			setCopyStatus('idle');
			if (slackWindow) {
				slackWindow.location.replace(slackInviteUrl);
			} else {
				window.location.assign(slackInviteUrl);
			}
		} catch {
			slackWindow?.close();
			setCopyStatus('failed');
		}
	};

	const handleSendError = async () => {
		if (!errorReport) {
			return;
		}
		setSendStatus('sending');
		try {
			const response = await fetch('/api/error-reports', {
				signal: AbortSignal.timeout(10_000),
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...errorReport,
					pageUrl,
				}),
			});
			setSendStatus(response.ok ? 'sent' : 'failed');
		} catch {
			setSendStatus('failed');
		}
	};

	return (
		<div
			className={cn(
				'flex items-center justify-center bg-background p-6',
				fullScreen ? 'min-h-screen' : 'h-full min-h-0 min-w-0 flex-1',
			)}
		>
			<div className='flex max-w-sm flex-col items-center gap-6 text-center'>
				<TriangleAlert className='size-10 stroke-[1.25] text-primary' aria-hidden />
				<div className='space-y-2'>
					<h1 className='text-lg font-medium tracking-tight'>Something went wrong</h1>
					<p className='text-sm text-muted-foreground'>
						We couldn't load this page.{' '}
						{isHomePage ? 'Reload the app and try again.' : 'Return home and try again.'}
					</p>
				</div>
				<div className='flex flex-col items-center'>
					{isHomePage ? (
						<Button onClick={() => window.location.reload()}>Reload app</Button>
					) : (
						<Button asChild className='rounded-full'>
							{fullScreen ? <a href='/'>Return to home</a> : <Link to='/'>Return to home</Link>}
						</Button>
					)}
					<div className='mt-6 w-full space-y-2 border-t pt-4'>
						<p className='text-xs text-muted-foreground'>Still having trouble?</p>
						<div className='flex items-center justify-center gap-1'>
							{errorReport && (
								<SimpleTooltip content={getSendStatusLabel(sendStatus)}>
									<Button
										variant='ghost'
										size='sm'
										aria-label={getSendStatusLabel(sendStatus)}
										disabled={sendStatus === 'sending'}
										onClick={() => void handleSendError()}
									>
										{sendStatus === 'sending' ? (
											<LoaderCircle className='size-3.5 animate-spin' />
										) : sendStatus === 'sent' ? (
											<Check className='size-3.5 text-emerald-500' />
										) : sendStatus === 'failed' ? (
											<X className='size-3.5 text-destructive' />
										) : (
											<Send className='size-3.5' />
										)}
										<span>{getSendStatusButtonLabel(sendStatus)}</span>
									</Button>
								</SimpleTooltip>
							)}
							<SimpleTooltip content={getSlackStatusLabel(copyStatus)}>
								<Button
									variant='ghost'
									size='sm'
									aria-label={getSlackStatusLabel(copyStatus)}
									disabled={copyStatus === 'copying'}
									onClick={() => void handleSlack()}
								>
									{copyStatus === 'copying' ? (
										<LoaderCircle className='size-3.5 animate-spin' />
									) : copyStatus === 'failed' ? (
										<X className='size-3.5 text-destructive' />
									) : (
										<SlackIcon className='size-3.5 [&_path]:fill-current' />
									)}
									<span>{copyStatus === 'failed' ? 'Try again' : 'Get help on Slack'}</span>
								</Button>
							</SimpleTooltip>
						</div>
						{copyStatus === 'failed' && errorDetails && (
							<div className='space-y-2 rounded-lg border p-3 text-left'>
								<p className='text-xs text-muted-foreground'>
									Couldn't copy automatically. Copy these details manually, then open Slack.
								</p>
								<pre className='max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs'>
									{errorDetails}
								</pre>
								<Button asChild variant='outline' size='sm'>
									<a href={slackInviteUrl} target='_blank' rel='noopener noreferrer'>
										Open Slack anyway
									</a>
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function getErrorReport(
	error: unknown,
	componentStack?: string | null,
): { message: string; stack?: string } | undefined {
	if (!(error instanceof Error)) {
		return undefined;
	}

	const reactStack = componentStack?.trim();
	const stack = [error.stack, reactStack && `React component stack:\n${reactStack}`].filter(Boolean).join('\n\n');
	return { message: `${error.name}: ${error.message}`, stack: stack || undefined };
}

function getErrorDetails(
	errorReport: { message: string; stack?: string } | undefined,
	pageUrl: string,
): string | undefined {
	if (!errorReport) {
		return undefined;
	}

	const details = [
		'Nao error report',
		'',
		`Error: ${errorReport.message}`,
		`Page: ${pageUrl}`,
		`Occurred: ${new Date().toISOString()}`,
	];
	if (errorReport.stack) {
		details.push('', 'Technical details:', errorReport.stack);
	}
	return details.join('\n');
}

function getSendStatusLabel(status: 'idle' | 'sending' | 'sent' | 'failed'): string {
	return {
		idle: 'Send an error report on our server',
		sending: 'Sending error report',
		sent: 'Error report sent',
		failed: 'Could not send error report',
	}[status];
}

function getSendStatusButtonLabel(status: 'idle' | 'sending' | 'sent' | 'failed'): string {
	return {
		idle: 'Report',
		sending: 'Reporting',
		sent: 'Reported',
		failed: 'Try again',
	}[status];
}

function getSlackStatusLabel(status: 'idle' | 'copying' | 'failed'): string {
	return {
		idle: 'Copy error details and open Slack',
		copying: 'Copying error details',
		failed: 'Could not copy error details',
	}[status];
}
