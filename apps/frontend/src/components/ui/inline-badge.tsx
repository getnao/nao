import { Badge } from '@/components/ui/badge';

export function InlineBadge({ children }: { children: React.ReactNode }) {
	return (
		<Badge variant='secondary' className='h-4 px-1 py-0 text-[9px] font-normal'>
			{children}
		</Badge>
	);
}
