/* @license Enterprise */

import { LockKeyholeIcon } from 'lucide-react';

import Auth0Icon from '@/components/icons/auth0-icon.svg';
import KeycloakIcon from '@/components/icons/keycloak-icon.svg';
import OktaIcon from '@/components/icons/okta-icon.svg';
import { Button } from '@/components/ui/button';
import { handleOidcSignIn } from '@/lib/auth-client';

const oidcProviderIcons: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
	okta: OktaIcon,
	auth0: Auth0Icon,
	keycloak: KeycloakIcon,
};

function getOidcProviderIcon(providerId: string) {
	return oidcProviderIcons[providerId.toLowerCase()] ?? LockKeyholeIcon;
}

interface OidcSignInButtonProps {
	providerId: string;
	providerName: string;
	callbackUrl?: string;
}

export function OidcSignInButton({ providerId, providerName, callbackUrl }: OidcSignInButtonProps) {
	const Icon = getOidcProviderIcon(providerId);
	return (
		<Button
			type='button'
			variant='outline'
			className='w-full h-11'
			onClick={() => void handleOidcSignIn(providerId, callbackUrl)}
		>
			<Icon className='w-5 h-5' />
			Continue with {providerName}
		</Button>
	);
}
