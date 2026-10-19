import GraphLoaderAnimated from '../icons/graph-loader-animated';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';

export function VisualizationSkeleton({ label }: { label: string }) {
	return (
		<div className='my-4 flex flex-col gap-2 items-center aspect-3/2'>
			<Skeleton className='w-1/2 h-4' />
			<Skeleton className='w-full flex-1 flex flex-col items-center justify-center gap-3'>
				<GraphLoaderAnimated className='w-96 max-w-full h-64 text-muted-foreground' />
				<TextShimmer text={label} />
			</Skeleton>
		</div>
	);
}
