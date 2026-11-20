import { FileText } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ContextRecommendationApplyResult } from '@nao/shared/context-editor';
import type { ToolCallComponentProps } from '.';
import { useOpenContextFileCallback } from '@/contexts/open-context-file-callback';
import { useToolCallContext } from '@/contexts/tool-call';

interface ListRecommendationsOutput {
	recommendations: { id: string; title: string }[];
	totalCount: number;
}

interface RecommendationOutput {
	title: string;
	status?: 'open' | 'applied' | 'dismissed';
}

const STATUS_TITLES: Record<NonNullable<RecommendationOutput['status']>, string> = {
	open: 'Reopened',
	applied: 'Marked as applied',
	dismissed: 'Dismissed',
};

export const ListRecommendationsToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output as ListRecommendationsOutput | undefined;
	const title = isSettled ? 'Looked at the recommendations' : 'Looking at the recommendations...';

	return (
		<ToolCallWrapper title={title} badge={output && `${output.totalCount}`}>
			{output && output.recommendations.length > 0 && (
				<ul className='flex flex-col gap-1 p-3 text-xs'>
					{output.recommendations.map((recommendation) => (
						<li key={recommendation.id} className='truncate'>
							{recommendation.title}
						</li>
					))}
				</ul>
			)}
		</ToolCallWrapper>
	);
};

export const GetRecommendationToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output as RecommendationOutput | undefined;
	if (!isSettled) {
		return <ToolCallWrapper title='Reading the recommendation...' />;
	}
	return <ToolCallWrapper title={<RecommendationTitle action='Read' title={output?.title} />} />;
};

export const SetRecommendationStatusToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output as RecommendationOutput | undefined;
	if (!isSettled || !output?.status) {
		return (
			<ToolCallWrapper
				title={isSettled ? 'Could not update the recommendation' : 'Updating the recommendation...'}
			/>
		);
	}
	return (
		<ToolCallWrapper title={<RecommendationTitle action={STATUS_TITLES[output.status]} title={output.title} />} />
	);
};

export const ApplyRecommendationToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const output = toolPart.output as ContextRecommendationApplyResult | undefined;
	if (!isSettled || !output) {
		return (
			<ToolCallWrapper
				title={isSettled ? 'Could not apply the recommendation' : 'Applying the recommendation...'}
			/>
		);
	}

	const action = output.conflicts.length > 0 ? 'Applied part of' : 'Applied';
	return (
		<ToolCallWrapper title={<RecommendationTitle action={action} title={output.title} />}>
			<AppliedFiles result={output} />
		</ToolCallWrapper>
	);
};

function RecommendationTitle({ action, title }: { action: string; title: string | undefined }) {
	return (
		<span>
			{action} <span className='truncate text-xs font-normal'>{title ?? 'the recommendation'}</span>
		</span>
	);
}

function AppliedFiles({ result }: { result: ContextRecommendationApplyResult }) {
	const { fire: openFile } = useOpenContextFileCallback();

	return (
		<ul className='flex flex-col gap-1 p-3 text-xs'>
			{[...result.changedPaths, ...result.unchangedPaths].map((path) => (
				<li key={path}>
					<button
						type='button'
						onClick={() => openFile(path)}
						className='flex cursor-pointer items-center gap-1.5 font-mono hover:underline'
					>
						<FileText className='size-3 shrink-0 text-muted-foreground' />
						{path}
					</button>
				</li>
			))}
			{result.conflicts.map((conflict) => (
				<li key={conflict.path} className='text-muted-foreground'>
					<span className='font-mono'>{conflict.path}</span>: {conflict.reason}
				</li>
			))}
		</ul>
	);
}
