import { TRPCClientError } from '@trpc/client';
import { ArrowRight, Check, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { trpcClient } from '@/main';

export function ContactSupportButton({ children }: { children: ReactNode }) {
	const { isCopied, copy } = useCopyToClipboard();
	const [open, setOpen] = useState(false);
	const [request, setRequest] = useState('');
	const [isPending, setIsPending] = useState(false);
	const [isSent, setIsSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	const [useMailFallback, setUseMailFallback] = useState(false);

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen) {
			setIsSent(false);
			setError(null);
			setCopyFailed(false);
			setUseMailFallback(false);
		}
		setOpen(nextOpen);
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmedRequest = request.trim();
		if (!trimmedRequest) {
			return;
		}

		setIsPending(true);
		setError(null);
		setUseMailFallback(false);
		try {
			await trpcClient.support.submit.mutate({ request: trimmedRequest });
			setRequest('');
			setIsSent(true);
		} catch (cause) {
			if (
				isTrpcClientError(cause) &&
				(cause.data?.code === 'PRECONDITION_FAILED' || cause.data?.code === 'TOO_MANY_REQUESTS')
			) {
				setError(cause.message);
				setUseMailFallback(cause.data.code === 'PRECONDITION_FAILED');
			} else {
				setError('We couldn’t send your request. Please try again.');
			}
		} finally {
			setIsPending(false);
		}
	};

	const handleCopyRequest = () => {
		setCopyFailed(false);
		copy(request.trim()).catch(() => setCopyFailed(true));
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant='primary-gradient'
					size='sm'
					className='group mt-3 flex w-fit rounded-full no-underline'
				>
					{children}
					<ArrowRight className='size-3.5 transition-transform group-hover:translate-x-0.5' />
				</Button>
			</DialogTrigger>
			<DialogContent className='border-violet/20 p-6 sm:max-w-lg sm:p-8'>
				{isSent ? (
					<div className='flex flex-col items-center text-center'>
						<DialogHeader className='items-center gap-3'>
							<DialogTitle className='font-borna text-xl font-medium tracking-tight'>
								Request sent
							</DialogTitle>
							<DialogDescription className='max-w-sm text-center leading-relaxed'>
								Thanks for reaching out. We’ll reply to the email associated with your account.
							</DialogDescription>
						</DialogHeader>
						<Button
							variant='primary-gradient'
							size='lg'
							className='mt-6 rounded-full px-8'
							onClick={() => setOpen(false)}
						>
							<Check />
							Done
						</Button>
					</div>
				) : (
					<>
						<DialogHeader>
							<DialogTitle className='font-borna text-xl font-medium tracking-tight'>
								How can we help?
							</DialogTitle>
							<DialogDescription className='sr-only'>
								Describe your issue in the support request field.
							</DialogDescription>
						</DialogHeader>
						<form className='mt-4 flex flex-col gap-4' onSubmit={handleSubmit}>
							<div>
								<Textarea
									aria-label='Support request'
									autoFocus
									className='min-h-36 resize-y rounded-2xl border-violet/20 bg-panel px-4 py-3 shadow-none focus-visible:border-violet/50 focus-visible:ring-violet/15'
									maxLength={5000}
									placeholder='Tell us what happened, what you expected, and anything else that could help…'
									required
									value={request}
									onChange={(event) => setRequest(event.target.value)}
								/>
								<p className='mt-2 text-right text-[11px] text-muted-foreground tabular-nums'>
									{request.length.toLocaleString()} / 5,000
								</p>
							</div>
							{error && (
								<p className='text-sm text-destructive' role='alert'>
									{error}
								</p>
							)}
							{useMailFallback ? (
								<div className='flex flex-col items-end gap-2'>
									{copyFailed && (
										<p className='text-sm text-destructive' role='alert'>
											We couldn’t copy your request. Select the text above and copy it manually.
										</p>
									)}
									<div className='flex flex-wrap justify-end gap-2'>
										<Button
											variant='outline'
											size='lg'
											className='rounded-full px-7'
											type='button'
											onClick={handleCopyRequest}
										>
											{isCopied ? <Check className='size-4' /> : <Copy className='size-4' />}
											{isCopied ? 'Copied' : 'Copy request'}
										</Button>
										<Button
											asChild
											variant='primary-gradient'
											size='lg'
											className='rounded-full px-7'
										>
											<a href={buildSupportMailto()}>
												Open email app
												<ArrowRight className='size-4' />
											</a>
										</Button>
									</div>
								</div>
							) : (
								<Button
									variant='primary-gradient'
									size='lg'
									className='self-end rounded-full px-7'
									type='submit'
									disabled={isPending || !request.trim()}
								>
									{isPending && <Loader2 className='animate-spin' />}
									{isPending ? 'Sending…' : 'Send to support'}
									{!isPending && <ArrowRight className='size-4' />}
								</Button>
							)}
						</form>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function isTrpcClientError(error: unknown): error is TRPCClientError<TrpcRouter> {
	return error instanceof TRPCClientError;
}

function buildSupportMailto(): string {
	const subject = encodeURIComponent('nao support request');
	return `mailto:support@getnao.io?subject=${subject}`;
}
