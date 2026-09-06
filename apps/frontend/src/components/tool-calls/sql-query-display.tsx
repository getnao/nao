import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { CSSProperties } from 'react';
import { useIsDarkMode } from '@/contexts/theme.provider';

interface SqlQueryDisplayProps {
	query: string;
}

SyntaxHighlighter.registerLanguage('sql', sql);

export function SqlQueryDisplay({ query }: SqlQueryDisplayProps) {
	const isDarkMode = useIsDarkMode();

	return (
		<div className='max-h-80 overflow-auto py-2 hide-code-header'>
			<SyntaxHighlighter
				language='sql'
				style={isDarkMode ? oneDark : oneLight}
				customStyle={highlighterStyle}
				codeTagProps={{ style: codeStyle }}
				showLineNumbers
				lineNumberStyle={lineNumberStyle}
			>
				{query.trim()}
			</SyntaxHighlighter>
		</div>
	);
}

const highlighterStyle: CSSProperties = {
	background: 'transparent',
	borderRadius: 0,
	fontSize: '0.8125rem',
	lineHeight: '1.25rem',
	margin: 0,
	padding: '0.625rem 0',
};

const codeStyle: CSSProperties = {
	background: 'transparent',
	fontFamily: 'inherit',
};

const lineNumberStyle: CSSProperties = {
	color: 'var(--muted-foreground)',
	minWidth: '3rem',
	opacity: 0.45,
	paddingRight: '1rem',
	userSelect: 'none',
};
