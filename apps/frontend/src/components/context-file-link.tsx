import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useOpenContextFileCallback } from '@/contexts/open-context-file-callback';
import { formatCodeLines, parseContextFileLink } from '@/lib/context-file-link';
import { requestFileLinesReveal } from '@/stores/code-reveal';

interface ContextFileLinkProps {
	path: string;
	lines: string;
	label: string;
}

/**
 * A context file the agent points at, opened in the Context Hub at the lines given when clicked. On a page that
 * cannot open context files, it stays as the text the agent wrote.
 */
export function ContextFileLink({ path, lines, label }: ContextFileLinkProps) {
	const openContextFile = useOpenContextFileCallback();
	const link = parseContextFileLink(path, lines);
	const fileName = link?.path.split('/').pop() ?? path;
	const text = label || fileName;

	if (!openContextFile || !link) {
		return <>{text}</>;
	}

	const openLink = () => {
		if (link.lines) {
			requestFileLinesReveal(link.path, link.lines);
		}
		openContextFile.fire(link.path);
	};
	const range = link.lines && formatCodeLines(link.lines);

	return (
		<SimpleTooltip content={range ? `${link.path} · ${range}` : link.path}>
			<button
				type='button'
				onClick={openLink}
				className='mx-0.5 inline-flex max-w-64 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-0.5 align-middle text-xs text-foreground transition-colors hover:bg-accent'
			>
				<FileExplorerIcon name={fileName} type='file' path={link.path} className='size-3.5' />
				<span className='truncate'>{text}</span>
				{range && <span className='shrink-0 text-muted-foreground'>{range}</span>}
			</button>
		</SimpleTooltip>
	);
}
