import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';

import { AuthForm } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { getEmailVerificationErrorMessage } from '@/lib/email-verification';
import { getSafeRedirectPath } from '@/lib/safe-redirect';

export const Route = createFileRoute('/email-verified')({
	validateSearch: (search: Record<string, unknown>) => ({
		error: typeof search.error === 'string' ? search.error : undefined,
		redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
	}),
	component: EmailVerified,
});

export function EmailVerified() {
	const router = useRouter();
	const { error, redirect } = Route.useSearch();
	const safeRedirect = getSafeRedirectPath(redirect);
	const errorMessage = getEmailVerificationErrorMessage(error);

	if (error) {
		return (
			<AuthForm
				title='Email not verified'
				content={
					<div className='flex flex-col items-center text-center'>
						<div className='mb-5 flex size-14 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/5'>
							<CircleAlert className='size-6 text-destructive' aria-hidden='true' />
						</div>
						<p role='alert' className='text-sm leading-6 text-muted-foreground'>
							{errorMessage ?? 'We could not verify this email address. Log in to request a new link.'}
						</p>
						<Button asChild variant='outline' className='mt-6 h-11 w-full rounded-full'>
							<Link to='/login' search={{ error: undefined, redirect: safeRedirect ?? undefined }}>
								Back to log in
							</Link>
						</Button>
					</div>
				}
			/>
		);
	}

	return (
		<AuthForm
			title='Email verified'
			titleClassName='text-emerald-600 dark:text-emerald-400'
			content={
				<div className='flex flex-col items-center text-center'>
					<div className='max-w-sm'>
						<p className='text-sm text-muted-foreground'>Your email address has been verified.</p>
						<p className='mt-3 text-sm leading-6 text-muted-foreground'>
							Return to your original tab, or continue here.
						</p>
					</div>
					<Button
						type='button'
						variant='outline'
						className='mt-6 h-11 w-full rounded-full'
						onClick={() => router.history.push(safeRedirect ?? '/')}
					>
						Continue to nao
					</Button>
				</div>
			}
		/>
	);
}
