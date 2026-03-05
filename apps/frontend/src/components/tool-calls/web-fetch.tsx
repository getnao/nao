import { Globe, ExternalLink } from 'lucide-react';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import { useToolCallContext } from '@/contexts/tool-call';

interface WebFetchResult {
	url: string;
	title?: string | null;
}

function parseOutput(output: unknown): WebFetchResult | null {
	if (typeof output !== 'object' || output === null) {
		return null;
	}
	const obj = output as Record<string, unknown>;
	if (typeof obj.url !== 'string') {
		return null;
	}
	const content = obj.content as Record<string, unknown> | undefined;
	return {
		url: obj.url,
		title: (content?.title as string) ?? null,
	};
}

function getDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export const WebFetchToolCall = ({ toolPart }: ToolCallComponentProps) => {
	const { isSettled } = useToolCallContext();
	const result = parseOutput(toolPart.output);
	const title = isSettled ? 'Fetched page' : 'Fetching page';

	return (
		<ToolCallWrapper title={title}>
			{result && (
				<div className='flex flex-col gap-0.5 py-1'>
					<a
						href={result.url}
						target='_blank'
						rel='noopener noreferrer'
						className='flex items-center gap-2 px-2 py-1.5 hover:bg-background/50 rounded text-sm group/source'
					>
						<Globe size={14} className='text-foreground/50 shrink-0' />
						<div className='flex-1 min-w-0 flex flex-col'>
							{result.title && (
								<span className='text-foreground/80 truncate text-xs'>{result.title}</span>
							)}
							<span className='font-mono text-xs text-foreground/40 truncate'>
								{getDomain(result.url)}
							</span>
						</div>
						<ExternalLink
							size={12}
							className='text-foreground/30 shrink-0 opacity-0 group-hover/source:opacity-100 transition-opacity'
						/>
					</a>
				</div>
			)}
		</ToolCallWrapper>
	);
};
