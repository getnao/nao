import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { FileViewer } from '@/components/settings/file-viewer';
import { trpc } from '@/main';

interface ContextHubFileProps {
	path: string;
	onDirtyChange: (isDirty: boolean) => void;
	onOpenFile: (path: string) => void;
}

/** A context file in the Context Hub, rendered as a document and editable when the user may change it. */
export function ContextHubFile({ path, onDirtyChange, onOpenFile }: ContextHubFileProps) {
	const navigate = useNavigate();
	const fileContent = useQuery(trpc.contextExplorer.readFile.queryOptions({ path }));
	const rulesPreviewGroups = useRulesPreviewGroupsState();

	return (
		<FileViewer
			key={path}
			filePath={path}
			content={fileContent.data?.content}
			hash={fileContent.data?.hash}
			isLoading={fileContent.isLoading}
			isError={fileContent.isError && !fileContent.data}
			isEditable={fileContent.data?.isEditable === true}
			editabilityGuidance={fileContent.data?.guidance ?? null}
			searchQuery=''
			sourceAutoOpenRequestId={null}
			hasMarkdownSourceViews={false}
			onDirtyChange={onDirtyChange}
			onOpenGuidancePath={(guidancePath, kind) => {
				if (kind === 'route') {
					void navigate({ to: guidancePath });
					return;
				}
				onOpenFile(guidancePath);
			}}
			onReload={async () => {
				const result = await fileContent.refetch();
				if (result.error) {
					throw result.error;
				}
				return result.data;
			}}
			rulesPreviewGroups={rulesPreviewGroups}
		/>
	);
}

function useRulesPreviewGroupsState() {
	const rulesPreviewGroups = useQuery(trpc.contextExplorer.getRulesPreviewGroups.queryOptions());
	if (rulesPreviewGroups.isLoading) {
		return { status: 'loading' } as const;
	}
	if (rulesPreviewGroups.isError || !rulesPreviewGroups.data) {
		return { status: 'error' } as const;
	}
	return { status: 'ready', ...rulesPreviewGroups.data } as const;
}
