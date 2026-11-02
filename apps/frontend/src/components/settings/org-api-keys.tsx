import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';

import type { ApiKeyScope } from '@nao/shared/api-key';

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';

const KEY_CARDS: Record<ApiKeyScope, { defaultName: string; title: string; description: string; emptyState: string }> =
	{
		deploy: {
			defaultName: 'Deploy key',
			title: 'Deploy keys',
			description: 'Organization keys that can run nao deploy to upload a project context.',
			emptyState: 'No deploy keys yet.',
		},
		user_management: {
			defaultName: 'User management key',
			title: 'User management API keys',
			description:
				'Keys for the user management REST API at /api/user-management. They can list, invite and remove users and manage groups and roles, but cannot deploy.',
			emptyState: 'No user management keys yet.',
		},
	};

interface OrgApiKeysProps {
	isAdmin?: boolean;
	scope: ApiKeyScope;
	deployUrl?: string;
	title?: string;
	description?: string;
}

export function OrgApiKeys({
	isAdmin = false,
	scope,
	deployUrl,
	title = KEY_CARDS[scope].title,
	description = KEY_CARDS[scope].description,
}: OrgApiKeysProps) {
	const queryClient = useQueryClient();
	const [latestPlaintextKey, setLatestPlaintextKey] = useState<string | null>(null);

	const apiKeys = useQuery({
		...trpc.apiKey.list.queryOptions(),
		enabled: isAdmin,
	});

	const revokeApiKey = useMutation(
		trpc.apiKey.revoke.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: trpc.apiKey.list.queryOptions().queryKey });
			},
		}),
	);

	if (!isAdmin) {
		return null;
	}

	const scopedApiKeys = apiKeys.data?.filter((apiKey) => apiKey.scope === scope) ?? [];

	return (
		<SettingsCard title={title} description={description}>
			<ApiKeyGenerator
				scope={scope}
				deployUrl={deployUrl}
				latestPlaintextKey={latestPlaintextKey}
				onPlaintextKeyCreated={setLatestPlaintextKey}
			/>

			<div className='space-y-3'>
				<div className='text-sm font-medium text-foreground'>Existing keys</div>
				{apiKeys.isLoading ? (
					<div className='text-sm text-muted-foreground'>Loading API keys...</div>
				) : scopedApiKeys.length ? (
					<div className='space-y-2'>
						{scopedApiKeys.map((apiKey) => (
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
					<div className='text-sm text-muted-foreground'>{KEY_CARDS[scope].emptyState}</div>
				)}
			</div>
		</SettingsCard>
	);
}

interface ApiKeyGeneratorProps {
	scope: ApiKeyScope;
	deployUrl?: string;
	latestPlaintextKey: string | null;
	onPlaintextKeyCreated: (plaintextKey: string) => void;
}

export function ApiKeyGenerator({ scope, deployUrl, latestPlaintextKey, onPlaintextKeyCreated }: ApiKeyGeneratorProps) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(KEY_CARDS[scope].defaultName);
	const { isCopied: isKeyCopied, copy: copyKey } = useCopyToClipboard();
	const { isCopied: isCommandCopied, copy: copyCommand } = useCopyToClipboard();
	const createApiKey = useMutation(
		trpc.apiKey.create.mutationOptions({
			onSuccess: async (result) => {
				onPlaintextKeyCreated(result.plaintext);
				setName(KEY_CARDS[scope].defaultName);
				await queryClient.invalidateQueries({ queryKey: trpc.apiKey.list.queryOptions().queryKey });
			},
		}),
	);
	const deployCommand = useMemo(() => {
		if (scope !== 'deploy' || !deployUrl) {
			return null;
		}

		return `nao deploy ${deployUrl} --api-key ${latestPlaintextKey ?? '<your-api-key>'}`;
	}, [scope, deployUrl, latestPlaintextKey]);

	const handleCreate = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			return;
		}

		await createApiKey.mutateAsync({ name: trimmedName, scope });
	};

	return (
		<div className='flex flex-col gap-4'>
			<div className='flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4'>
				<div className='flex items-start gap-3'>
					<div className='flex size-9 items-center justify-center rounded-md bg-background text-muted-foreground'>
						<KeyRound className='size-4' />
					</div>
					<div className='min-w-0 flex-1 space-y-1'>
						<div className='text-sm font-medium text-foreground'>
							{scope === 'deploy' ? 'Generate a deploy key' : 'Generate a user management API key'}
						</div>
						<p className='text-sm text-muted-foreground'>
							{scope === 'deploy' ? (
								<>
									Create an API key for your organization, then use it with{' '}
									<code className='dollar'>nao deploy</code> to upload a project context.
								</>
							) : (
								<>
									Create an API key for the user management REST API at{' '}
									<code>/api/user-management</code>: it can list, invite and remove users, manage
									groups and roles, and purge an account with its stories, but it cannot deploy.
								</>
							)}
						</p>
					</div>
				</div>

				<div className='flex flex-col gap-2 sm:flex-row'>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={KEY_CARDS[scope].defaultName}
						aria-label='API key name'
					/>
					<Button
						variant='primary-gradient'
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
		</div>
	);
}

function formatDate(timestamp: number | null) {
	if (!timestamp) {
		return 'never';
	}

	return new Date(timestamp).toLocaleString();
}
