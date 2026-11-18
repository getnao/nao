import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

import { cn } from '@/lib/utils';

interface SqlQueryDisplayProps {
	query: string;
	className?: string;
}

export function SqlQueryDisplay({ query, className }: SqlQueryDisplayProps) {
	return (
		<div className={cn('overflow-auto max-h-80 hide-code-header px-3 py-2', className)}>
			<Streamdown className='sql-query-display' mode='static' controls={{ code: false }} plugins={{ code }}>
				{`\`\`\`sql\n${query.trim()}\n\`\`\``}
			</Streamdown>
		</div>
	);
}
