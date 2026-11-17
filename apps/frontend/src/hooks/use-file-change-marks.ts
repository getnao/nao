import { useMemo } from 'react';

import type { FileChangeMark } from '@/components/settings/file-tree';
import { toFileChangeKind } from '@/components/settings/change-kind';
import { useUpstreamChanges } from '@/components/settings/upstream-file-diff';
import { useContextChanges } from '@/hooks/use-context-changes';
import { useUpstreamTestSource } from '@/hooks/use-upstream-test-source';

/** The user's changed files, then those of the synced repository branch picked for tests, by tree path. */
export function useFileChangeMarks(): Map<string, FileChangeMark> {
	const { changedFiles } = useContextChanges();
	const [source] = useUpstreamTestSource();
	const upstreamChanges = useUpstreamChanges(source);

	return useMemo(() => {
		const marks = new Map<string, FileChangeMark>();
		for (const change of upstreamChanges.data?.changes ?? []) {
			marks.set(`/${change.path}`, { kind: change.kind, isUpstream: true });
		}
		for (const file of changedFiles.data ?? []) {
			marks.set(file.path, { kind: toFileChangeKind(file.kind), isUpstream: false });
		}
		return marks;
	}, [changedFiles.data, upstreamChanges.data]);
}
