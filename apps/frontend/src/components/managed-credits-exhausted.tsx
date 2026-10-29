import { Link } from '@tanstack/react-router';
import { CircleDollarSign, KeyRound } from 'lucide-react';

import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';

type ManagedCreditsExhaustedProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	canAddProviderKey: boolean;
	creditOrganizationId?: string;
};

export function ManagedCreditsExhausted({
	open,
	onOpenChange,
	canAddProviderKey,
	creditOrganizationId,
}: ManagedCreditsExhaustedProps) {
	const openOrganizationBilling = useOpenOrganizationBilling();
	const canAddCredits = Boolean(creditOrganizationId);
	const canManageAccess = canAddProviderKey || canAddCredits;
	const title = 'You’re out of nao credits';
	const description = canManageAccess
		? 'Add credits or use your own AI provider to continue chatting. Your chats, projects, and data are safe.'
		: 'Ask your organization admin to add credits or connect an AI provider. Your chats, projects, and data are safe.';

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className='sm:flex-wrap sm:justify-center'>
					{canManageAccess ? (
						<ManagedCreditsActions
							canAddProviderKey={canAddProviderKey}
							creditOrganizationId={creditOrganizationId}
							onAddCredits={openOrganizationBilling}
						/>
					) : (
						<Button
							variant='outline'
							size='sm'
							className='rounded-full'
							onClick={() => onOpenChange(false)}
						>
							Got it
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ManagedCreditsActions({
	canAddProviderKey,
	creditOrganizationId,
	onAddCredits,
}: {
	canAddProviderKey: boolean;
	creditOrganizationId?: string;
	onAddCredits: (organizationId: string) => Promise<void>;
}) {
	return (
		<>
			{creditOrganizationId && (
				<Button
					variant='primary-gradient'
					size='sm'
					className='h-8 rounded-full px-4'
					onClick={() => void onAddCredits(creditOrganizationId)}
				>
					<CircleDollarSign />
					Buy nao credits
				</Button>
			)}
			{canAddProviderKey && (
				<Button
					asChild
					variant='outline'
					size='sm'
					className='h-8 rounded-full border-primary/20 bg-background/80 px-4'
				>
					<Link to='/settings/project/agent' search={{ tab: 'models' }}>
						<KeyRound />
						Use your own AI provider
					</Link>
				</Button>
			)}
		</>
	);
}
