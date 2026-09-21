import type { writeFile } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

export const WriteOutput = ({ output }: { output: writeFile.Output }) => {
	return <Block>{`Saved ${output.path} (${formatSize(output.size)}).`}</Block>;
};
