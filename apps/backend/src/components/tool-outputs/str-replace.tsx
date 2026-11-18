import type { strReplace } from '@nao/shared/tools';

import { Block } from '../../lib/markdown';
import { formatSize } from '../../utils/utils';

export const StrReplaceOutput = ({ output }: { output: strReplace.Output }) => {
	const occurrences = output.replacements === 1 ? '1 occurrence' : `${output.replacements} occurrences`;
	return <Block>{`Edited ${output.path} (${occurrences} replaced, now ${formatSize(output.size)}).`}</Block>;
};
