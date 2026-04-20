import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';

interface OrgApiKeysProps {
	isAdmin?: boolean;
	deployUrl?: string;
	title?: string;
	description?: string;
}

export function OrgApiKeys({
	isAdmin = false,
	deployUrl,
	title = 'Organization API keys',
	description = 'Generate organization-scoped API keys for actions like deploying a project from the nao CLI.',
}: OrgApiKeysProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState('Deploy key');
	const [latestPlaintextKey, setLatestPlaintextKey] = useState<string | null>(null);
	const { isCopied: isKeyCopied, copy: copyKey } = useCopyToClipboard();
	const { isCopied: isCommandCopied, copy: copyCommand } = useCopyToClipboard();

	const apiKeys = useQuery({
		...trpc.apiKey.list.queryOptions(),
		enabled: isAdmin,
	});

	const createApiKey = useMutation(
		trpc.apiKey.create.mutationOptions({
			onSuccess: async (result) => {
				setLatestPlaintextKey(result.plaintext);
				setName('Deploy key');
				await queryClient.invalidateQueries({ queryKey: trpc.apiKey.list.queryOptions().queryKey });
			},
		}),
	);

	const revokeApiKey = useMutation(
		trpc.apiKey.revoke.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.apiKey.list.queryOptions().queryKey });
			},
		}),
	);

	const deployCommand = useMemo(() => {
		if (!deployUrl) {
			return null;
		}

		return `nao deploy ${deployUrl} --api-key ${latestPlaintextKey ?? '<your-api-key>'}`;
	}, [deployUrl, latestPlaintextKey]);

	if (!isAdmin) {
		return null;
	}

	const handleCreate = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return;
		}

		await createApiKey.mutateAsync({ name: trimmedName });
	};

	return (
		<SettingsCard title={title} description={description}>
			<div className='flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4'>
				<div className='flex items-start gap-3'>
					<div className='flex size-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
						<KeyRound className='size-4' />
					</div>
					<div className='min-w-0 flex-1 space-y-1'>
						<div className='text-sm font-medium text-foreground'>Generate a deploy key</div>
						<p className='text-sm text-muted-foreground'>
							Create an API key for your organization, then use it with{' '}
							<code className='dollar'>nao deploy</code> to upload a project context.
						</p>
					</div>
				</div>

				<div className='flex flex-col gap-2 sm:flex-row'>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder='Deploy key'
						aria-label='API key name'
					/>
					<Button
						onClick={() => handleCreate().catch(console.error)}
						disabled={!name.trim()}
						isLoading={createApiKey.isPending}
					>
						Generate API key
					</Button>
				</div>
			</div>

			{latestPlaintextKey && (
				<div className='flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20'>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
						<div className='space-y-1'>
							<div className='text-sm font-medium text-foreground'>New API key</div>
							<p className='text-sm text-muted-foreground'>
								Copy it now. This is the only time the full key will be shown.
							</p>
						</div>
						<Button
							variant='outline'
							size='sm'
							onClick={() => copyKey(latestPlaintextKey).catch(console.error)}
						>
							{isKeyCopied ? (
								<Check className='size-3.5 text-green-500' />
							) : (
								<Copy className='size-3.5' />
							)}
							{isKeyCopied ? 'Copied' : 'Copy key'}
						</Button>
					</div>

					<code className='overflow-x-auto rounded-md border bg-background px-3 py-2 text-xs font-mono break-all'>
						{latestPlaintextKey}
					</code>
				</div>
			)}

			{deployCommand && (
				<div className='flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4'>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'>
						<div className='space-y-1'>
							<div className='text-sm font-medium text-foreground'>Deploy command</div>
							<p className='text-sm text-muted-foreground'>
								Run this from the folder that contains <code>nao_config.yaml</code>.
							</p>
						</div>
						<Button
							variant='outline'
							size='sm'
							onClick={() => copyCommand(deployCommand).catch(console.error)}
						>
							{isCommandCopied ? (
								<Check className='size-3.5 text-green-500' />
							) : (
								<Copy className='size-3.5' />
							)}
							{isCommandCopied ? 'Copied' : 'Copy command'}
						</Button>
					</div>

					<code className='overflow-x-auto rounded-md border bg-background px-3 py-2 text-xs font-mono whitespace-pre'>
						{deployCommand}
					</code>
				</div>
			)}

			<div className='space-y-3'>
				<div className='text-sm font-medium text-foreground'>Existing keys</div>
				{apiKeys.isLoading ? (
					<div className='text-sm text-muted-foreground'>Loading API keys...</div>
				) : apiKeys.data?.length ? (
					<div className='space-y-2'>
						{apiKeys.data.map((apiKey) => (
							<div
								key={apiKey.id}
								className='flex flex-col gap-3 rounded-lg border border-border/60 bg-background p-3 sm:flex-row sm:items-center sm:justify-between'
							>
								<div className='min-w-0 space-y-1'>
									<div className='text-sm font-medium text-foreground'>
										{apiKey.name}{' '}
										<span className='text-xs font-mono text-muted-foreground'>
											{apiKey.keyPrefix}...
										</span>
									</div>
									<div className='text-xs text-muted-foreground'>
										Created {formatDate(apiKey.createdAt)}
										{apiKey.lastUsedAt
											? ` • Last used ${formatDate(apiKey.lastUsedAt)}`
											: ' • Never used'}
									</div>
								</div>
								<Button
									variant='outline'
									size='sm'
									onClick={() => revokeApiKey.mutate({ id: apiKey.id })}
									disabled={revokeApiKey.isPending}
								>
									<Trash2 className='size-3.5' />
									Revoke
								</Button>
							</div>
						))}
					</div>
				) : (
					<div className='text-sm text-muted-foreground'>No API keys created yet.</div>
				)}
			</div>
		</SettingsCard>
	);
}

function formatDate(timestamp: number | null) {
	if (!timestamp) {
		return 'never';
	}

	return new Date(timestamp).toLocaleString();
}
