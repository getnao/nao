import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { ReactNode } from 'react';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { FileDiffPanel } from '@/components/settings/context-file-diff';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Spinner } from '@/components/ui/spinner';
import { useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { computeLineDiff } from '@/lib/line-diff';
import { trpc } from '@/main';

export type UpstreamFileChange = inferRouterOutputs<TrpcRouter>['testRun']['getUpstreamChanges']['changes'][number];

const CHANGE_KIND_LABELS: Record<UpstreamFileChange['kind'], string> = {
	added: 'New file',
	modified: 'Edited',
	deleted: 'Removed',
};

export function UpstreamFileDiff({ path }: { path: string }) {
	const [source] = useUpstreamTestSource();
	const upstreamChanges = useUpstreamChanges(source);
	const change = upstreamChanges.data?.changes.find((candidate) => candidate.path === path);
	const diff = useMemo(
		() => (change ? computeLineDiff(change.productionContent ?? '', change.branchContent ?? '') : null),
		[change],
	);

	if (upstreamChanges.isLoading) {
		return (
			<CenteredMessage>
				<Spinner />
			</CenteredMessage>
		);
	}
	if (upstreamChanges.isError) {
		return (
			<CenteredMessage>
				<span className='flex flex-col items-center gap-2'>
					<ErrorMessage message={upstreamChanges.error.message} />
					<Button variant='outline' size='pill' onClick={() => upstreamChanges.refetch()}>
						Retry
					</Button>
				</span>
			</CenteredMessage>
		);
	}
	if (!source || !change || !diff) {
		return <CenteredMessage>This branch no longer changes this file.</CenteredMessage>;
	}
	if (isUnreadable(change)) {
		return <CenteredMessage>This file is too large or not text, so its changes cannot be shown.</CenteredMessage>;
	}
	return (
		<FileDiffPanel
			path={path}
			changeLabel={CHANGE_KIND_LABELS[change.kind]}
			diff={diff}
			contents={{ old: change.productionContent ?? '', new: change.branchContent ?? '' }}
		/>
	);
}

function CenteredMessage({ children }: { children: ReactNode }) {
	return (
		<div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
			{children}
		</div>
	);
}

/** The sync is cached on the server per branch commit, so refetching on focus only costs a branch lookup. */
export function useUpstreamChanges(source: UpstreamTestSource | null) {
	return useQuery({
		...trpc.testRun.getUpstreamChanges.queryOptions(source ?? { repo: '', branch: '' }),
		enabled: source !== null,
	});
}

/** The server leaves out the content it cannot show on a side where the file exists. */
function isUnreadable(change: UpstreamFileChange): boolean {
	return (
		(change.kind !== 'added' && change.productionContent === null) ||
		(change.kind !== 'deleted' && change.branchContent === null)
	);
}
