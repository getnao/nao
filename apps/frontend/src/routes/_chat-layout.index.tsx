import { createFileRoute } from '@tanstack/react-router';
import { useSession } from '@/lib/auth-client';
import { capitalize } from '@/lib/utils';

export const Route = createFileRoute('/_chat-layout/')({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = useSession();
	const username = session?.user?.name;

	return (
		<div className='flex flex-col items-center justify-end pb-8 mt-[20vh]'>
			{/* Logo container with fixed height */}
			<div className='relative w-full h-[200px] flex items-center justify-center px-6'>
				<img
					src='/nao-logo-greyscale.svg'
					alt=''
					className='w-[200px] h-auto select-none opacity-[0.05]'
					aria-hidden='true'
				/>
			</div>

			<h1 className='text-3xl md:text-4xl font-light tracking-tight text-slate-700 text-center px-6'>
				{username ? capitalize(username) : ''}, what do you want to analyse?
			</h1>
		</div>
	);
}
