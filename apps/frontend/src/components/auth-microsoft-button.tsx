/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';

import MicrosoftIcon from '@/components/icons/microsoft-icon.svg';
import { AuthSocialButton } from '@/components/ui/button';
import { handleMicrosoftSignIn } from '@/lib/microsoft-auth';
import { trpc } from '@/main';

export function useIsMicrosoftSetup(): boolean {
	const isMicrosoftSetup = useQuery(trpc.authConfig.microsoft.isSetup.queryOptions());
	return Boolean(isMicrosoftSetup.data);
}

interface MicrosoftSignInButtonProps {
	callbackUrl?: string;
	className?: string;
}

export function MicrosoftSignInButton({ callbackUrl, className }: MicrosoftSignInButtonProps = {}) {
	return (
		<AuthSocialButton
			icon={MicrosoftIcon}
			label='Continue with Microsoft'
			onClick={() => void handleMicrosoftSignIn(callbackUrl)}
			className={className}
		/>
	);
}
