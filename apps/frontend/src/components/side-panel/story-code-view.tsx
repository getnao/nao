import { memo } from 'react';
import { Editor } from '@monaco-editor/react';

const MONACO_OPTIONS = {
	minimap: { enabled: false },
	folding: true,
	lineNumbers: 'on' as const,
	scrollbar: { horizontal: 'auto' as const, vertical: 'auto' as const },
	scrollBeyondLastLine: false,
	padding: { top: 16, bottom: 16 },
	wordWrap: 'on' as const,
	readOnly: true,
};

export const StoryCodeView = memo(function StoryCodeView({ code }: { code: string }) {
	return (
		<div className='h-full'>
			<Editor value={code} language='markdown' theme='light' options={MONACO_OPTIONS} />
		</div>
	);
});
