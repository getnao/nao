import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

import type { WebRobotAuthoringResult } from '@/components/settings/web-source-recipe';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

type WebSourceCreateFromUrlProps = {
	onCreated: (robotId: string) => void;
	onPrefillRecipe: (recipe: WebRobotRecipe, title?: string) => void;
};

export function WebSourceCreateFromUrl({ onCreated, onPrefillRecipe }: WebSourceCreateFromUrlProps) {
	const [url, setUrl] = useState('');
	const create = useMutation(
		trpc.webRobot.createFromUrl.mutationOptions({
			onSuccess: (result) => {
				if (result.status === 'created') {
					onCreated(result.robot.id);
				}
			},
		}),
	);
	const result = create.data;

	return (
		<SettingsCard
			title='Create from catalogue URL'
			description='Let nao inspect a public product catalogue, generate a deterministic recipe, test it, and queue the first run.'
			action={
				<Button
					type='button'
					size='sm'
					disabled={!url.trim() || create.isPending}
					isLoading={create.isPending}
					onClick={() => create.mutate({ url: url.trim() })}
				>
					<Sparkles className='size-3.5' />
					Create automatically
				</Button>
			}
		>
			<label className='grid gap-1.5 text-sm'>
				<span className='text-xs font-medium text-muted-foreground'>Catalogue URL</span>
				<Input
					type='url'
					value={url}
					onChange={(event) => setUrl(event.target.value)}
					placeholder='https://example.com/products'
					disabled={create.isPending}
				/>
			</label>

			{create.error && <ErrorMessage message={create.error.message} />}
			{result && result.status !== 'created' && (
				<AuthoringRejected result={result} onPrefillRecipe={onPrefillRecipe} />
			)}
		</SettingsCard>
	);
}

function AuthoringRejected({
	result,
	onPrefillRecipe,
}: {
	result: Extract<WebRobotAuthoringResult, { status: 'rejected' | 'interactive_needed' | 'partial' }>;
	onPrefillRecipe: (recipe: WebRobotRecipe, title?: string) => void;
}) {
	const labels = { rejected: 'Rejected', interactive_needed: 'Interactive', partial: 'Partial' };
	const observedPagination = result.diagnostics.discovery.pagination.filter((entry) => entry.observed).length;
	return (
		<div className='grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3'>
			<div className='flex items-center gap-2'>
				<Badge variant={result.status === 'rejected' ? 'destructive' : 'context_admin'}>
					{labels[result.status]}
				</Badge>
				<ErrorMessage message={result.reason} />
			</div>
			<div className='flex flex-wrap gap-2'>
				<Badge variant='outline'>APIs {result.diagnostics.discovery.counts.api}</Badge>
				<Badge variant='outline'>Endpoints {result.diagnostics.discovery.counts.endpoint}</Badge>
				<Badge variant='outline'>JSON-LD {result.diagnostics.discovery.counts.jsonLd}</Badge>
				<Badge variant='outline'>Embedded {result.diagnostics.discovery.counts.embedded}</Badge>
				<Badge variant='outline'>DOM {result.diagnostics.discovery.counts.dom}</Badge>
				<Badge variant='outline'>Details {result.diagnostics.discovery.counts.detail}</Badge>
				<Badge variant='outline'>Pagination {result.diagnostics.discovery.counts.pagination}</Badge>
				{result.diagnostics.discovery.counts.actions > 0 && (
					<Badge variant='outline'>Actions {result.diagnostics.discovery.counts.actions}</Badge>
				)}
				{observedPagination > 0 && <Badge variant='success'>Observed {observedPagination}</Badge>}
			</div>
			{result.diagnostics.discovery.blockers.length > 0 && (
				<div className='grid gap-1 text-xs text-muted-foreground'>
					{result.diagnostics.discovery.blockers.map((blocker) => (
						<div key={`${blocker.loader}-${blocker.kind}-${blocker.status ?? ''}`}>
							{blocker.kind}: {blocker.message}
						</div>
					))}
				</div>
			)}
			{result.warnings.length > 0 && (
				<div className='grid gap-1 text-xs text-muted-foreground'>
					{result.warnings.slice(0, 5).map((warning) => (
						<div key={warning}>{warning}</div>
					))}
				</div>
			)}
			{result.diagnostics.candidates.length > 0 && (
				<div className='grid gap-2'>
					{result.diagnostics.candidates.slice(0, 6).map((candidate) => (
						<div
							key={candidate.id}
							className='flex items-center justify-between gap-3 rounded-md border p-2 text-xs'
						>
							<span className='min-w-0 truncate'>
								{candidate.strategy} · {candidate.error ?? 'rejected'}
							</span>
							<Badge variant={candidate.status === 'accepted' ? 'success' : 'outline'}>
								{candidate.score}
							</Badge>
						</div>
					))}
				</div>
			)}
			{result.recipe && (
				<Button
					type='button'
					variant='secondary'
					size='sm'
					className='justify-self-start'
					onClick={() => onPrefillRecipe(result.recipe!, result.diagnostics.discovery.title)}
				>
					Open generated recipe in advanced editor
				</Button>
			)}
		</div>
	);
}
