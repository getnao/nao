import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, CircleDollarSign, KeyRound } from 'lucide-react';

import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { useOpenOrganizationBilling } from '@/hooks/use-open-organization-billing';
import { setActiveOrganizationId } from '@/lib/active-organization';

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
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const canAddCredits = Boolean(creditOrganizationId);
	const canManageAccess = canAddProviderKey || canAddCredits;
	const title = 'You’re out of nao credits';

	const openOrganizationMembers = async () => {
		if (!creditOrganizationId) {
			return;
		}

		setActiveOrganizationId(creditOrganizationId);
		await queryClient.invalidateQueries();
		await navigate({ to: '/settings/organization/members' });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className='gap-6 p-8 sm:max-w-lg'>
				<DialogHeader className='gap-3 text-left'>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription className='leading-relaxed'>
						{canAddCredits ? (
							<>
								{canAddProviderKey ? 'Add credits, bring your own API key, or ' : 'Add credits or '}
								<Link
									to='/settings/organization/members'
									className='inline-flex items-center gap-0.5 font-medium text-foreground hover:underline'
									onClick={(event) => {
										event.preventDefault();
										void openOrganizationMembers();
									}}
								>
									invite users
									<ArrowUpRight className='size-3.5' />
								</Link>{' '}
								to continue chatting. Your chats, projects, and data are safe.
							</>
						) : canAddProviderKey ? (
							'Bring your own API key to continue chatting. Your chats, projects, and data are safe.'
						) : (
							'Ask your organization admin to add credits or connect an AI provider. Your chats, projects, and data are safe.'
						)}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className='flex-row flex-wrap gap-3'>
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
					className='h-10 flex-1 rounded-full px-5'
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
					className='h-10 flex-1 rounded-full border-primary/20 bg-background/80 px-5'
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
