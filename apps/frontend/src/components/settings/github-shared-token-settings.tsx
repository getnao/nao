import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { QueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { trpc } from '@/main';

const FINE_GRAINED_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export interface SharedTokenAccount {
	login: string;
	avatarUrl: string;
}

export function GithubSharedTokenForm({ canEdit }: { canEdit: boolean }) {
	const queryClient = useQueryClient();
	const [token, setToken] = useState('');
	const saveToken = useMutation(
		trpc.github.saveSharedAccessToken.mutationOptions({
			onSuccess: async () => {
				setToken('');
				await invalidateSharedTokenQueries(queryClient);
			},
		}),
	);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		saveToken.mutate({ token });
	};

	return (
		<div className='space-y-3 text-sm text-muted-foreground'>
			<p>
				Create a{' '}
				<a href={FINE_GRAINED_TOKEN_URL} target='_blank' rel='noreferrer' className='text-foreground underline'>
					fine-grained personal access token
				</a>{' '}
				on the GitHub account nao should act as, ideally a dedicated bot account. Give it access to the context
				files repository with <span className='text-foreground'>Contents</span> and{' '}
				<span className='text-foreground'>Pull requests</span> set to read and write.
			</p>
			<p>
				nao commits and opens pull requests as this account, and adds the person who made each change as a
				co-author.
			</p>
			{canEdit ? (
				<form className='flex max-w-xl flex-col gap-2' onSubmit={handleSubmit}>
					<div className='flex gap-2'>
						<div className='min-w-0 flex-1'>
							<Input
								type='password'
								autoComplete='off'
								aria-label='GitHub access token'
								placeholder='github_pat_...'
								value={token}
								onChange={(event) => {
									setToken(event.target.value);
								}}
							/>
						</div>
						<Button
							type='submit'
							size='sm'
							className='h-9'
							disabled={!token.trim()}
							isLoading={saveToken.isPending}
						>
							Save token
						</Button>
					</div>
					{saveToken.error && <ErrorMessage message={saveToken.error.message} />}
				</form>
			) : (
				<p>Ask a project admin to save the access token.</p>
			)}
		</div>
	);
}

export function GithubSharedTokenSummary({
	account,
	error,
	canEdit,
}: {
	account: SharedTokenAccount | null;
	error: string | null;
	canEdit: boolean;
}) {
	const queryClient = useQueryClient();
	const removeToken = useMutation(
		trpc.github.removeSharedAccessToken.mutationOptions({
			onSuccess: () => invalidateSharedTokenQueries(queryClient),
		}),
	);

	return (
		<div className='flex min-w-0 flex-col items-end gap-1'>
			<div className='flex min-w-0 items-center gap-3'>
				{account && (
					<div className='flex min-w-0 items-center gap-2'>
						<img src={account.avatarUrl} alt='' className='size-6 rounded-full' />
						<span className='truncate text-sm text-foreground'>{account.login}</span>
					</div>
				)}
				{canEdit && (
					<Button
						size='sm'
						variant='secondary'
						isLoading={removeToken.isPending}
						onClick={() => {
							removeToken.mutate();
						}}
					>
						Remove token
					</Button>
				)}
			</div>
			{error && <p className='text-xs text-destructive'>{error}</p>}
			{removeToken.error && <ErrorMessage message={removeToken.error.message} />}
		</div>
	);
}

async function invalidateSharedTokenQueries(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: trpc.github.getSharedAccessToken.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.github.listSharedAccessTokenRepos.queryKey() }),
		queryClient.invalidateQueries({ queryKey: trpc.contextExplorer.getRepositoryStatus.queryKey() }),
	]);
}
