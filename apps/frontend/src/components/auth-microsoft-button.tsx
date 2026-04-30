/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';

import MicrosoftIcon from '@/components/icons/microsoft-icon.svg';
import { Button } from '@/components/ui/button';
import { handleMicrosoftSignIn } from '@/lib/microsoft-auth';
import { trpc } from '@/main';

export function useIsMicrosoftSetup(): boolean {
	const isMicrosoftSetup = useQuery(trpc.authConfig.microsoft.isSetup.queryOptions());
	return Boolean(isMicrosoftSetup.data);
}

export function MicrosoftSignInButton() {
	return (
		<Button type='button' variant='outline' className='w-full h-11' onClick={() => void handleMicrosoftSignIn()}>
			<MicrosoftIcon className='w-5 h-5' />
			Continue with Microsoft
		</Button>
	);
}
