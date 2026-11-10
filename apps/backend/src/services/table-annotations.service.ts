import path from 'path';

export type TableAnnotations = { path: string; content: string };

const TABLE_COLUMNS_PATH = /^\/databases\/(?:.+\/)?table=[^/]+\/columns\.md$/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/**
 * Agents often skip annotations.md, so human notes are attached to every columns.md read.
 * Missing, unreadable or empty annotations are ignored.
 */
export async function findTableAnnotations(
	columnsPath: string,
	readSibling: (siblingPath: string) => Promise<string>,
): Promise<TableAnnotations | undefined> {
	const virtualPath = toVirtualPath(columnsPath);
	if (!TABLE_COLUMNS_PATH.test(virtualPath)) {
		return undefined;
	}
	const annotationsPath = path.posix.join(path.posix.dirname(virtualPath), 'annotations.md');
	const content = await readSibling(annotationsPath).catch(() => '');
	const notes = stripFrontmatter(content).trim();
	return notes ? { path: annotationsPath, content: notes } : undefined;
}

function toVirtualPath(filePath: string): string {
	return path.posix.normalize(`/${filePath.replaceAll('\\', '/')}`);
}

function stripFrontmatter(content: string): string {
	return content.replace(FRONTMATTER, '');
}
