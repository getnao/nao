import { Editor } from '@monaco-editor/react';

import { useEditorTheme } from '@/hooks/use-editor-theme';

export function WebSourceRecipeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const editorTheme = useEditorTheme();

	return (
		<div className='overflow-hidden rounded-md border border-input'>
			<Editor
				value={value}
				language='json'
				theme={editorTheme}
				height='28rem'
				onChange={(nextValue) => onChange(nextValue ?? '')}
				options={{
					minimap: { enabled: false },
					fontSize: 13,
					lineNumbers: 'on',
					scrollBeyondLastLine: false,
					wordWrap: 'on',
					tabSize: 2,
					automaticLayout: true,
				}}
			/>
		</div>
	);
}
