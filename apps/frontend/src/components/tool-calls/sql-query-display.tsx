import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

interface SqlQueryDisplayProps {
	query: string;
}

export function SqlQueryDisplay({ query }: SqlQueryDisplayProps) {
	return (
		<div className='overflow-auto max-h-80 hide-code-header py-2'>
			<Streamdown mode='static' controls={{ code: false }} plugins={{ code }}>
				{`\`\`\`sql\n${query}\n\`\`\``}
			</Streamdown>
		</div>
	);
}
