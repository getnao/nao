import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { FileContentResponse } from '@nao/shared/types';

import type { UpstreamFileChange } from '@/components/settings/upstream-file-diff';
import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { useUpstreamChanges } from '@/components/settings/upstream-file-diff';
import { useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { addBranchFiles } from '@/lib/upstream-file-tree';
import { trpc } from '@/main';

interface ContextFile {
	data: FileContentResponse | undefined;
	isLoading: boolean;
	isError: boolean;
	refetch: () => Promise<{ data?: FileContentResponse; error: unknown }>;
}

/**
 * The files of the context as `nao sync` at the synced repository branch picked would leave them: the production tree
 * with the files the branch adds. Those it removes stay listed, marked as removed.
 */
export function useContextFileTree() {
	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const upstreamChanges = useUpstreamChanges(useUpstreamTestSource()[0]);
	const entries = useMemo(() => {
		const addedPaths = (upstreamChanges.data?.changes ?? [])
			.filter((change) => change.kind === 'added')
			.map((change) => change.path);
		return addBranchFiles(fileTree.data?.entries ?? [], addedPaths);
	}, [fileTree.data, upstreamChanges.data]);
	return { ...fileTree, entries };
}

/** A context file at the synced repository branch picked, read-only, or as production has it when the branch keeps it. */
export function useContextFile(path: string | null): ContextFile {
	const [source] = useUpstreamTestSource();
	const upstreamChanges = useUpstreamChanges(source);
	const branchContent = path ? findBranchContent(upstreamChanges.data?.changes ?? [], path) : null;
	const branchFile = useMemo(() => (branchContent === null ? null : toBranchFile(branchContent)), [branchContent]);
	const isWaitingForBranch = source !== null && upstreamChanges.isPending;
	const savedFile = useQuery({
		...trpc.contextExplorer.readFile.queryOptions({ path: path ?? '' }),
		enabled: path !== null && branchFile === null && !isWaitingForBranch,
	});

	if (source !== null && upstreamChanges.isError) {
		return {
			data: undefined,
			isLoading: false,
			isError: true,
			refetch: async () => ({ error: (await upstreamChanges.refetch()).error }),
		};
	}
	if (branchFile) {
		return {
			data: branchFile,
			isLoading: false,
			isError: false,
			refetch: async () => ({ data: branchFile, error: null }),
		};
	}
	return {
		data: savedFile.data,
		isLoading: isWaitingForBranch || savedFile.isLoading,
		isError: savedFile.isError,
		refetch: savedFile.refetch,
	};
}

/** The tests of production, or as the synced repository branch picked leaves them. */
export function useTestSuite() {
	const [source] = useUpstreamTestSource();
	return useQuery(trpc.testRun.listTests.queryOptions(source ? { upstream: source } : undefined));
}

/** Syncs the branch again at its latest commit, as its changes and tests are otherwise kept for a few minutes. */
export function useRefreshUpstreamBranch() {
	const queryClient = useQueryClient();
	return useCallback(
		(source: UpstreamTestSource) =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.testRun.getUpstreamChanges.queryKey(source) }),
				queryClient.invalidateQueries({ queryKey: trpc.testRun.listTests.queryKey({ upstream: source }) }),
			]),
		[queryClient],
	);
}

function findBranchContent(changes: UpstreamFileChange[], path: string): string | null {
	const projectPath = path.replace(/^\/+/, '');
	const change = changes.find((candidate) => candidate.path === projectPath);
	return change?.kind === 'deleted' ? null : (change?.branchContent ?? null);
}

function toBranchFile(content: string): FileContentResponse {
	return { content, hash: '', isEditable: false, reason: 'synced-source' };
}
