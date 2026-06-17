import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { Badge } from '@/components/ui/badge';
import { useToolCallContext } from '@/contexts/tool-call';
import { SEVERITY_BADGE_VARIANT } from '@/lib/recommendation-severity';

type Severity = 'high' | 'medium' | 'low';

interface RecommendationInsight {
	signalType: string;
	metric: string;
	count: number;
	exampleChatIds?: string[];
	snippet?: string;
}

interface RecordRecommendationInput {
	suggestedFile?: string;
	subjectKey?: string;
	severity?: Severity;
	title?: string;
	summary?: string;
	suggestedAction?: string;
	insights?: RecommendationInsight[];
}

export const RecordRecommendationToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();

	const input = toolPart.input as RecordRecommendationInput | undefined;
	const insights = input?.insights ?? [];

	return (
		<ToolCallWrapper
			defaultExpanded={false}
			title={
				<span>
					Recommendation{' '}
					<span className='text-xs font-normal truncate'>{input?.title ?? input?.subjectKey}</span>
				</span>
			}
			badge={
				input?.severity ? (
					<Badge variant={SEVERITY_BADGE_VARIANT[input.severity]}>{input.severity}</Badge>
				) : undefined
			}
		>
			{isSettled && input ? (
				<div className='flex flex-col gap-2 p-3 text-sm'>
					{input.summary && <p className='text-foreground/70'>{input.summary}</p>}
					{input.suggestedAction && (
						<p>
							<span className='font-medium'>Fix:</span> {input.suggestedAction}
						</p>
					)}
					{input.suggestedFile && (
						<p className='text-xs text-foreground/50'>
							File: <code className='bg-background/50 px-1 py-0.5 rounded'>{input.suggestedFile}</code>
						</p>
					)}
					{insights.length > 0 && (
						<div className='flex flex-col gap-1'>
							{insights.map((insight, index) => (
								<div key={index} className='flex items-center gap-2 text-xs text-foreground/60'>
									<Badge variant='outline'>{insight.signalType}</Badge>
									<span className='truncate'>{insight.metric}</span>
									<span className='text-foreground/40'>×{insight.count}</span>
								</div>
							))}
						</div>
					)}
				</div>
			) : (
				<div className='p-4 text-center text-foreground/50 text-sm'>Recording recommendation...</div>
			)}
		</ToolCallWrapper>
	);
};
