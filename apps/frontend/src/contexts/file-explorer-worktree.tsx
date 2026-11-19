import { createContext, useContext } from 'react';

export interface FileExplorerWorktree {
	hasUnsavedFileChanges: boolean;
	/** Closes the opened files, which may not exist on the branch switched to. */
	onRepositoryChanged: () => void;
}

const FileExplorerWorktreeContext = createContext<FileExplorerWorktree | null>(null);

export const FileExplorerWorktreeProvider = FileExplorerWorktreeContext.Provider;

/** Null outside the File Explorer, where switching its branch has no meaning. */
export function useFileExplorerWorktree(): FileExplorerWorktree | null {
	return useContext(FileExplorerWorktreeContext);
}
