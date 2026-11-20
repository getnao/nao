import { useEffect } from 'react';
import type { MountedCodeEditor } from '@/components/code-selection-ask';
import type { EditorLink } from '@/lib/editor-links';
import { bindEditorLinks, rangeAtColumn } from '@/lib/editor-links';

const NAO_CONFIG_PATH = /(^|\/)nao_config\.ya?ml$/;
const FILE_REFERENCE_PATTERN = /\bfrom_file:\s*(["']?)([^\s"'#]+)\1/g;

/** Makes the `from_file` paths of nao_config.yaml Cmd/Ctrl+clickable, opening the file they point at. */
export function useFileReferenceLinks(
	codeEditor: MountedCodeEditor | null,
	filePath: string,
	onOpenFile: ((path: string) => void) | undefined,
) {
	useEffect(() => {
		if (!codeEditor || !onOpenFile || !NAO_CONFIG_PATH.test(filePath)) {
			return;
		}
		return bindEditorLinks(codeEditor, (line, lineNumber, column) =>
			findFileReferenceAt(line, lineNumber, column, onOpenFile),
		);
	}, [codeEditor, filePath, onOpenFile]);
}

/** The path is relative to the project root, where nao_config.yaml sits. */
export function findFileReferenceAt(
	line: string,
	lineNumber: number,
	column: number,
	onOpenFile: (path: string) => void,
): EditorLink | null {
	for (const match of line.matchAll(FILE_REFERENCE_PATTERN)) {
		const referencedPath = match[2];
		const pathStart = match.index + match[0].lastIndexOf(referencedPath);
		const range = rangeAtColumn(lineNumber, pathStart + 1, referencedPath.length, column);
		if (range) {
			return { range, follow: () => onOpenFile(`/${referencedPath.replace(/^(\.\/)+/, '')}`) };
		}
	}
	return null;
}
