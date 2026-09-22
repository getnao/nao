/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';

import MicrosoftIcon from '@/components/icons/microsoft-icon.svg';
import { AuthSocialButton } from '@/components/ui/button';
import { rememberSignInMethod } from '@/lib/last-sign-in-method';
import { handleMicrosoftSignIn } from '@/lib/microsoft-auth';
import { trpc } from '@/main';

export function useIsMicrosoftSetup() {
	const isMicrosoftSetup = useQuery(trpc.authConfig.microsoft.isSetup.queryOptions());
	return {
		isSetup: Boolean(isMicrosoftSetup.data),
		isPending: isMicrosoftSetup.isPending,
	};
}

interface MicrosoftSignInButtonProps {
	callbackUrl?: string;
	lastUsed?: boolean;
	className?: string;
}

export function MicrosoftSignInButton({ callbackUrl, lastUsed, className }: MicrosoftSignInButtonProps = {}) {
	return (
		<AuthSocialButton
			icon={MicrosoftIcon}
			label='Continue with Microsoft'
			onClick={() => {
				rememberSignInMethod('microsoft');
				void handleMicrosoftSignIn(callbackUrl);
			}}
			lastUsed={lastUsed}
			className={className}
		/>
	);
}
