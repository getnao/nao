import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { FileTree } from '@/components/settings/file-tree';
import { FileViewer } from '@/components/settings/file-viewer';
import { Button } from '@/components/ui/button';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { requireAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/context-explorer')({
	beforeLoad: requireAdmin,
	component: ContextExplorerPage,
});

function ContextExplorerPage() {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const fileTree = useQuery(trpc.contextExplorer.getFileTree.queryOptions());
	const fileContent = useQuery({
		...trpc.contextExplorer.readFile.queryOptions({ path: selectedPath! }),
		enabled: !!selectedPath,
	});

	return (
		<div className='flex flex-col flex-1 overflow-hidden'>
			<div className='flex items-center justify-between px-6 py-4 border-b border-border shrink-0'>
				<div>
					<h1 className='text-xl font-semibold'>File Explorer</h1>
					<p className='text-sm text-muted-foreground'>Browse files in the context folder (read-only)</p>
				</div>
				<Button variant='outline' size='sm' onClick={() => fileTree.refetch()} disabled={fileTree.isFetching}>
					<RefreshCw className='size-3.5' />
					Refresh
				</Button>
			</div>

			<ResizablePanelGroup
				orientation='horizontal'
				className='flex-1 min-h-0'
				defaultLayout={{ tree: 1, viewer: 3 }}
			>
				<ResizablePanel id='tree' minSize={180}>
					<div className='h-full overflow-hidden bg-card border-r border-border'>
						{fileTree.isLoading ? (
							<div className='flex items-center justify-center h-32'>
								<Spinner />
							</div>
						) : fileTree.isError ? (
							<div className='flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2'>
								<p>Failed to load files</p>
								<Button variant='outline' size='sm' onClick={() => fileTree.refetch()}>
									Retry
								</Button>
							</div>
						) : (
							<FileTree
								entries={fileTree.data ?? []}
								selectedPath={selectedPath}
								onSelectFile={setSelectedPath}
							/>
						)}
					</div>
				</ResizablePanel>

				<ResizableSeparator />

				<ResizablePanel id='viewer' minSize={300}>
					<div className='h-full bg-background'>
						<FileViewer
							filePath={selectedPath}
							content={fileContent.data?.content}
							isLoading={fileContent.isLoading && fileContent.fetchStatus !== 'idle'}
							isError={fileContent.isError}
						/>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}
