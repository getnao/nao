import { pluralize } from '@nao/shared';
import type { list } from '@nao/shared/tools';

import { Block, List, ListItem, Span } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

export const ListOutput = ({ output }: { output: list.Output }) => {
	const entries = Array.isArray(output) ? output : output.entries;
	if (entries.length === 0) {
		return 'Directory is empty.';
	}

	const files = entries.filter((e) => e.type === 'file');
	const directories = entries.filter((e) => e.type === 'directory');
	const symbolicLinks = entries.filter((e) => e.type === 'symbolic_link');
	const unknown = entries.filter((e) => e.type === undefined);

	return (
		<Block>
			{files.length > 0 && <EntryGroup title={'File'} entries={files} format={formatFileEntry} />}

			{directories.length > 0 && (
				<EntryGroup title={'Directory'} entries={directories} format={formatDirectoryEntry} />
			)}

			{symbolicLinks.length > 0 && (
				<EntryGroup title={'Symbolic Link'} entries={symbolicLinks} format={formatFileEntry} />
			)}
			{unknown.length > 0 && (
				<EntryGroup title={`Unknown (${unknown.length})`} entries={unknown} format={formatFileEntry} />
			)}
		</Block>
	);
};

function EntryGroup({
	title,
	entries,
	format,
}: {
	title: string;
	entries: list.Entry[];
	format: (entry: list.Entry) => string;
}) {
	return (
		<Block separator={'\n'}>
			<Span>
				{pluralize(title, entries.length)} ({entries.length})
			</Span>
			<List>
				{entries.map((entry) => (
					<ListItem>{format(entry)}</ListItem>
				))}
			</List>
		</Block>
	);
}

function formatFileEntry(entry: list.Entry) {
	if (entry.size) {
		return `${entry.name} (${formatSize(Number(entry.size))})`;
	}
	return entry.name;
}

function formatDirectoryEntry(entry: list.Entry) {
	if (entry.itemCount !== undefined) {
		return `${entry.name} (${entry.itemCount} items)`;
	}
	return entry.name;
}
