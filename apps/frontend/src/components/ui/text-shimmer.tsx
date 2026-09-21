import { useMemo } from 'react';

import NaoLogoAnimated from '@/components/icons/nao-logo-animated';
import { cn } from '@/lib/utils';

const DEFAULT_WORDS = ['Crunching', 'Analyzing', 'Thinking'];

export const TextShimmer = ({
	className,
	text,
	showLogo = false,
}: {
	className?: string;
	text?: string;
	showLogo?: boolean;
}) => {
	const randomWord = useMemo(() => DEFAULT_WORDS[Math.floor(Math.random() * DEFAULT_WORDS.length)], []);
	const label = text ?? randomWord;

	return (
		<div className={cn('flex items-center gap-2', className)}>
			{showLogo && <NaoLogoAnimated height={12} width={21} durationSeconds={2.2} title='' />}
			<span className='text-sm text-foreground font-medium'>{label}</span>
		</div>
	);
};
