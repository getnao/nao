import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMatchRoute, useNavigate } from '@tanstack/react-router';
import type { FileTreeEntry } from '@nao/shared/types';

import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { useOpenContextFileCallback } from '@/contexts/open-context-file-callback';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { getFileName } from '@/lib/file-path';
import { rankPathsByQuery } from '@/lib/path-search';
import { trpc } from '@/main';

const MAX_SHOWN_FILES = 50;

/** Finds any file of the context by name and opens it in the File Explorer, from every settings page. */
export function GoToFileDialog() {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const openFile = useOpenFileInExplorer();

	useKeyboardShortcuts({ 'go-to-file': () => handleOpenChange(!isOpen) });

	function handleOpenChange(open: boolean) {
		setIsOpen(open);
		if (!open) {
			setQuery('');
		}
	}

	function handleSelect(path: string) {
		handleOpenChange(false);
		openFile(path);
	}

	return (
		<CommandDialog open={isOpen} onOpenChange={handleOpenChange} shouldFilter={false} loop title='Go to file'>
			<CommandInput placeholder='Search files by name...' value={query} onValueChange={setQuery} />
			{isOpen && <MatchingFiles query={query} onSelect={handleSelect} />}
		</CommandDialog>
	);
}

function MatchingFiles({ query, onSelect }: { query: string; onSelect: (path: string) => void }) {
	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const filePaths = useMemo(() => collectFilePaths(fileTree.data?.entries ?? []), [fileTree.data?.entries]);
	const shownPaths = useMemo(() => rankPathsByQuery(filePaths, query).slice(0, MAX_SHOWN_FILES), [filePaths, query]);

	if (fileTree.isLoading) {
		return (
			<div className='flex justify-center py-6'>
				<Spinner />
			</div>
		);
	}
	if (fileTree.isError) {
		return <p className='py-6 text-center text-sm text-muted-foreground'>Failed to load files.</p>;
	}

	return (
		<CommandList>
			<CommandEmpty>No matching files.</CommandEmpty>
			{shownPaths.length > 0 && (
				<CommandGroup>
					{shownPaths.map((path) => (
						<FileItem key={path} path={path} onSelect={() => onSelect(path)} />
					))}
				</CommandGroup>
			)}
		</CommandList>
	);
}

function FileItem({ path, onSelect }: { path: string; onSelect: () => void }) {
	const name = getFileName(path) ?? path;
	const folder = path.slice(0, path.lastIndexOf('/')).replace(/^\//, '');

	return (
		<CommandItem value={path} onSelect={onSelect}>
			<FileExplorerIcon name={name} type='file' path={path} />
			<span className='shrink-0'>{name}</span>
			<span className='truncate text-xs text-muted-foreground'>{folder}</span>
		</CommandItem>
	);
}

/** Opens the file in the File Explorer shown, which asks before dropping unsaved changes, or navigates to it. */
function useOpenFileInExplorer() {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const { fire: openFileInShownExplorer } = useOpenContextFileCallback();

	return (path: string) => {
		if (matchRoute({ to: '/settings/context-explorer' })) {
			openFileInShownExplorer(path);
			return;
		}
		void navigate({ to: '/settings/context-explorer', search: { path } });
	};
}

function collectFilePaths(entries: FileTreeEntry[]): string[] {
	return entries.flatMap((entry) => (entry.type === 'file' ? [entry.path] : collectFilePaths(entry.children ?? [])));
}
