import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function SettingsVersionInfo() {
	const versionInfo = useQuery({
		...trpc.system.version.queryOptions(),
	});

	const version = versionInfo.data?.version;
	const commit = versionInfo.data?.commit;
	const buildDate = versionInfo.data?.buildDate;

	return (
		<div className='flex flex-col gap-2 text-xs mt-auto opacity-50'>
			<div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1'>
				<span className='text-muted-foreground'>Version</span>
				<span className='font-mono text-foreground'>{version ?? 'unknown'}</span>
				<span className='text-muted-foreground'>Commit</span>
				<span className='font-mono text-foreground'>{commit ?? 'unknown'}</span>
				<span className='text-muted-foreground'>Build date</span>
				<span className='font-mono text-foreground'>{buildDate || 'unknown'}</span>
			</div>
		</div>
	);
}
