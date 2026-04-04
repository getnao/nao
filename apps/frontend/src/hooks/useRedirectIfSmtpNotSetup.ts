import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useRedirectIfSmtpNotSetup() {
	const navigate = useNavigate();
	const isSmtpSetup = useQuery(trpc.authConfig.smtp.isSetup.queryOptions());

	useEffect(() => {
		if (isSmtpSetup.data === false) {
			navigate({ to: '/login', search: { error: undefined } });
		}
	}, [isSmtpSetup.data, navigate]);

	return isSmtpSetup.isPending;
}
