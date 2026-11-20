import { Spinner } from '@/components/ui/spinner';

export function PageLoader() {
	return (
		<div className='flex h-screen flex-1 items-center justify-center bg-background'>
			<Spinner className='size-6' />
		</div>
	);
}
