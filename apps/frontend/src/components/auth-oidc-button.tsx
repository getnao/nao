/* @license Enterprise */

import { LockKeyholeIcon } from 'lucide-react';

import Auth0Icon from '@/components/icons/auth0-icon.svg';
import KeycloakIcon from '@/components/icons/keycloak-icon.svg';
import OktaIcon from '@/components/icons/okta-icon.svg';
import { AuthSocialButton } from '@/components/ui/button';
import { handleOidcSignIn } from '@/lib/auth-client';
import { rememberSignInMethod } from '@/lib/last-sign-in-method';

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
	lastUsed?: boolean;
	className?: string;
}

export function OidcSignInButton({
	providerId,
	providerName,
	callbackUrl,
	lastUsed,
	className,
}: OidcSignInButtonProps) {
	const Icon = getOidcProviderIcon(providerId);
	return (
		<AuthSocialButton
			icon={Icon}
			label={`Continue with ${providerName}`}
			onClick={() => {
				rememberSignInMethod('oidc');
				void handleOidcSignIn(providerId, callbackUrl);
			}}
			lastUsed={lastUsed}
			className={className}
		/>
	);
}
