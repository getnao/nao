import { USER_ROLE_LABELS } from '@nao/shared/types';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import type { UserRole } from '@nao/shared/types';

import { EditableOrganizationName } from '@/components/settings/editable-organization-name';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getActiveOrganizationId, setActiveOrganizationId } from '@/lib/active-organization';

type OrganizationOption = {
	id: string;
	name: string;
	role: UserRole;
};

type OrganizationHeadingProps = {
	organization: OrganizationOption;
	organizations: OrganizationOption[];
	canEdit: boolean;
};

export function OrganizationHeading({ organization, organizations, canEdit }: OrganizationHeadingProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const activeOrganizationId = getActiveOrganizationId();
		if (activeOrganizationId && activeOrganizationId !== organization.id) {
			setActiveOrganizationId(organization.id);
		}
	}, [organization.id]);

	const switchOrganization = async (organizationId: string) => {
		setOpen(false);
		setActiveOrganizationId(organizationId);
		if (organizationId === organization.id) {
			return;
		}

		await queryClient.invalidateQueries();
		await router.invalidate();
	};

	return (
		<EditableOrganizationName name={organization.name} canEdit={canEdit}>
			{organizations.length > 1 ? (
				<Popover open={open} onOpenChange={setOpen}>
					<h1>
						<PopoverTrigger asChild>
							<button
								type='button'
								aria-label={`Switch organization. Current organization: ${organization.name}`}
								aria-expanded={open}
								className='flex h-8 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-lg font-semibold text-foreground transition-colors hover:bg-accent'
							>
								<span className='truncate'>{organization.name}</span>
								<ChevronsUpDown className='size-4 shrink-0 text-muted-foreground' />
							</button>
						</PopoverTrigger>
					</h1>
					<PopoverContent align='start' className='w-64 p-0'>
						<Command loop>
							{organizations.length > 5 && <CommandInput placeholder='Search organizations...' />}
							<CommandList className='max-h-72'>
								<CommandEmpty>No organizations found.</CommandEmpty>
								<CommandGroup>
									{organizations.map((option) => (
										<CommandItem
											key={option.id}
											value={option.id}
											keywords={[option.name, USER_ROLE_LABELS[option.role]]}
											onSelect={() => void switchOrganization(option.id)}
										>
											<span className='min-w-0 flex-1 truncate font-semibold'>{option.name}</span>
											<span className='ml-auto shrink-0 text-xs text-muted-foreground'>
												{USER_ROLE_LABELS[option.role]}
											</span>
											{option.id === organization.id && (
												<Check className='size-4 text-foreground' />
											)}
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			) : undefined}
		</EditableOrganizationName>
	);
}
