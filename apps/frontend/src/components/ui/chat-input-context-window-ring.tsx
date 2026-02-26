import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/main';
import { useChatId } from '@/hooks/use-chat-id';
import { useAgentContext } from '@/contexts/agent.provider';

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clampPercent(percent: number): number {
	return Math.max(0, Math.min(100, percent));
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return String(n);
}

function buildTooltipText({
	percent,
	tokensUsed,
	contextWindow,
}: {
	percent: number;
	tokensUsed: number;
	contextWindow: number;
}): string {
	const percentLabel = percent.toFixed(1);
	return `${percentLabel}% · ${formatTokens(tokensUsed)}/${formatTokens(contextWindow)} context used`;
}

function ringColor(value: number): string {
	if (value >= 85) {
		return 'stroke-destructive';
	}
	if (value >= 65) {
		return 'stroke-amber-500';
	}
	return 'stroke-muted-foreground/60';
}

interface ContextWindowRingProps {
	className?: string;
}

export function ContextWindowRing({ className }: ContextWindowRingProps) {
	const chatId = useChatId();
	const { selectedModel, messages, isRunning } = useAgentContext();
	const hasAssistantMessage = messages.some((m) => m.role === 'assistant');

	const contextUsage = useQuery(
		trpc.chat.getContextUsage.queryOptions(
			{
				chatId: chatId ?? '',
				model: selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : undefined,
			},
			{
				enabled: !!chatId && !isRunning && hasAssistantMessage && !!selectedModel,
				staleTime: 60_000,
			},
		),
	);

	if (isRunning || !hasAssistantMessage || contextUsage.data?.contextWindow == null) {
		return null;
	}

	const tokensUsed = contextUsage.data.tokensUsed;
	const contextWindow = contextUsage.data.contextWindow;

	const percentRaw = tokensUsed > 0 ? (tokensUsed / contextWindow) * 100 : 0;
	const percent = tokensUsed > 0 ? Math.min(100, Math.max(0.1, parseFloat(percentRaw.toFixed(1)))) : 0;
	const clamped = clampPercent(percent);
	const offset = CIRCUMFERENCE * (1 - clamped / 100);
	const tooltipText = buildTooltipText({ percent: clamped, tokensUsed, contextWindow });

	return (
		<TooltipProvider>
			<Tooltip delayDuration={200}>
				<TooltipTrigger asChild>
					<span
						tabIndex={0}
						aria-label={tooltipText}
						className='inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
					>
						<svg
							width='20'
							height='20'
							viewBox='0 0 20 20'
							className={cn('-rotate-90', className)}
							aria-hidden='true'
						>
							<circle
								cx='10'
								cy='10'
								r={RADIUS}
								fill='none'
								strokeWidth='2.5'
								className='stroke-muted-foreground/20'
							/>
							<circle
								cx='10'
								cy='10'
								r={RADIUS}
								fill='none'
								strokeWidth='2.5'
								strokeLinecap='round'
								strokeDasharray={CIRCUMFERENCE}
								strokeDashoffset={offset}
								className={cn('transition-[stroke-dashoffset,stroke] duration-700', ringColor(clamped))}
							/>
						</svg>
					</span>
				</TooltipTrigger>
				<TooltipContent side='top' align='center'>
					{tooltipText}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
