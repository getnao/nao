import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	getDefaultContextFileHeader,
	readContextFileHeader,
	validateContextFileHeader,
} from '@nao/shared/context-file-header';
import type {
	ContextFileHeader,
	ContextFileHeaderProblem,
	ContextFileHeaderReading,
	ContextFileOwner,
} from '@nao/shared/context-file-header';

import { trpc } from '@/main';

export interface FileHeaderState {
	reading: ContextFileHeaderReading;
	problems: ContextFileHeaderProblem[];
	/** Null while the users of the project load. */
	owners: ContextFileOwner[] | null;
	defaults: Pick<ContextFileHeader, 'title' | 'description'>;
}

/** The header of the Markdown file being edited, checked against the users of the project as the user types. */
export function useFileHeader(filePath: string, content: string, isMarkdown: boolean): FileHeaderState | null {
	const owners = useQuery({
		...trpc.contextExplorer.listFileOwners.queryOptions(),
		staleTime: 60_000,
		enabled: isMarkdown,
	});
	const userEmails = useMemo(
		() => (owners.data ? new Set(owners.data.map((owner) => owner.email.toLowerCase())) : undefined),
		[owners.data],
	);

	return useMemo(() => {
		if (!isMarkdown) {
			return null;
		}
		return {
			reading: readContextFileHeader(content),
			problems: validateContextFileHeader(content, { filePath, userEmails }),
			owners: owners.data ?? null,
			defaults: getDefaultContextFileHeader(filePath),
		};
	}, [content, filePath, isMarkdown, owners.data, userEmails]);
}
