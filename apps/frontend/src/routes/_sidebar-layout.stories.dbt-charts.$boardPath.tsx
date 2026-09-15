import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import { DbtChartsBoard } from '@/components/dbt-charts/dbt-charts-board';
import { StoryCodeView } from '@/components/side-panel/story-code-view';
import { StoryAccessError } from '@/components/story-access-error';
import { StoryPageHeader } from '@/components/story-page-header';
import { Spinner } from '@/components/ui/spinner';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/dbt-charts/$boardPath')({
	component: ProjectBoardPage,
});

/** A dbt Charts board that lives in the project's `charts/` folder: rendered read-only from the file on disk. */
function ProjectBoardPage() {
	const { boardPath } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { isViewer } = usePermissions();
	const [viewMode, setViewMode] = useState<StoryViewMode>('preview');

	const boardQuery = useQuery(trpc.dbtCharts.getProjectBoard.queryOptions({ boardPath }));
	const board = boardQuery.data;

	const importMutation = useMutation(
		trpc.dbtCharts.importProjectBoard.mutationOptions({
			onSuccess: ({ storyId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				navigate({ to: '/stories/standalone/$storyId', params: { storyId } });
			},
		}),
	);

	if (boardQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (boardQuery.isError || !board) {
		return <StoryAccessError error={boardQuery.error} onRetry={() => boardQuery.refetch()} />;
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={board.title}
				authorName={board.path}
				openChatLabel='Copy to my stories'
				onOpenChat={isViewer ? undefined : () => importMutation.mutate({ boardPath })}
				isOpeningChat={importMutation.isPending}
				viewModeControls={{ viewMode, onViewModeChange: setViewMode, canEdit: false }}
			/>
			{viewMode === 'code' ? (
				<div className='flex-1 min-h-0'>
					<StoryCodeView code={board.yaml} format='dbt_charts' readOnly />
				</div>
			) : (
				<div className='flex-1 min-h-0 overflow-auto'>
					<DbtChartsBoard
						yaml={board.yaml}
						resetKey={boardPath}
						className='mx-auto w-full max-w-6xl p-4 md:p-8'
					/>
				</div>
			)}
		</div>
	);
}
