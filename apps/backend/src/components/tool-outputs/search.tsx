import { pluralize } from '@nao/shared';
import type { searchFiles } from '@nao/shared/tools';

import { Block, ListItem, TitledList } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

const MAX_FILES = 100;
const MAX_DIRECTORIES = 10;

export const SearchOutput = ({ output }: { output: searchFiles.Output }) => {
	const files = Array.isArray(output) ? output : output.files;
	if (files.length === 0) {
		return <Block>No matches.</Block>;
	}

	const remainingFiles = files.slice(MAX_FILES);
	const uniqueDirs = getUniqueDirs(remainingFiles);

	return (
		<Block>
			<TitledList title={`${pluralize('Match', files.length)} (${files.length})`} maxItems={MAX_FILES}>
				{files.map((file) => (
					<ListItem>{formatFile(file)}</ListItem>
				))}
			</TitledList>
			{uniqueDirs.length > 0 && (
				<TitledList title='More matches in' maxItems={MAX_DIRECTORIES}>
					{uniqueDirs.map((dir) => (
						<ListItem>{dir}</ListItem>
					))}
				</TitledList>
			)}
		</Block>
	);
};

const formatFile = (file: searchFiles.File) => {
	return file.size ? `${file.path} (${formatSize(Number(file.size))})` : file.path;
};

const getUniqueDirs = (files: searchFiles.File[]) => {
	return [...new Set(files.map((f) => f.dir))].sort((a, b) => a.length - b.length);
};
