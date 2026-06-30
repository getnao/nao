import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { UserRule } from '@/queries/use-rules';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useRuleMutations, useRulesQuery } from '@/queries/use-rules';
import { cn } from '@/lib/utils';

export function SettingsRules() {
	const { data: rules, isLoading } = useRulesQuery();
	const { createMutation, updateMutation, deleteMutation } = useRuleMutations();

	const [newRule, setNewRule] = useState('');
	const [editRule, setEditRule] = useState<UserRule | null>(null);
	const [editContent, setEditContent] = useState('');
	const [ruleToDelete, setRuleToDelete] = useState<UserRule | null>(null);

	const handleCreate = async () => {
		const content = newRule.trim();
		if (!content) {
			return;
		}
		await createMutation.mutateAsync({ content });
		setNewRule('');
	};

	const handleSaveEdit = async () => {
		if (!editRule) {
			return;
		}
		await updateMutation.mutateAsync({ ruleId: editRule.id, content: editContent });
		setEditRule(null);
	};

	const handleConfirmDelete = () => {
		if (!ruleToDelete) {
			return;
		}
		deleteMutation.mutate({ ruleId: ruleToDelete.id });
	};

	return (
		<>
			<SettingsCard
				title='Rules'
				titleSize='lg'
				description='Personal rules are added to every system prompt in this project and layered on top of the global project rules. They only apply to your own chats.'
				divide
			>
				<div className='space-y-3'>
					<Textarea
						value={newRule}
						onChange={(event) => setNewRule(event.target.value)}
						placeholder='e.g. Always format currency values with a $ sign and two decimals.'
						rows={3}
					/>
					{createMutation.error?.message && <ErrorMessage message={createMutation.error.message} />}
					<div className='flex justify-end'>
						<Button
							size='sm'
							onClick={handleCreate}
							disabled={createMutation.isPending || newRule.trim().length === 0}
						>
							<Plus />
							Add rule
						</Button>
					</div>
				</div>
			</SettingsCard>

			<SettingsCard title='Your rules' description='Review and manage the rules you have defined.' divide>
				{isLoading ? (
					<div className='flex flex-col divide-y'>
						<RuleSkeleton className='pt-0' />
						<RuleSkeleton />
						<RuleSkeleton className='pb-0' />
					</div>
				) : !rules?.length ? (
					<Empty>No rules defined yet.</Empty>
				) : (
					<div className='flex flex-col divide-y'>
						{rules.map((rule) => (
							<RuleItem
								key={rule.id}
								rule={rule}
								className='last:pb-0 first:pt-0'
								onEdit={() => {
									setEditRule(rule);
									setEditContent(rule.content);
								}}
								onDelete={() => setRuleToDelete(rule)}
							/>
						))}
					</div>
				)}

				<Dialog open={!!editRule} onOpenChange={() => setEditRule(null)}>
					<DialogContent className='p-6' showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>Edit rule</DialogTitle>
						</DialogHeader>
						<div className='space-y-4'>
							<Textarea
								value={editContent}
								onChange={(event) => setEditContent(event.target.value)}
								rows={4}
							/>
							{updateMutation.error?.message && <ErrorMessage message={updateMutation.error.message} />}
						</div>
						<DialogFooter>
							<Button
								variant='ghost'
								onClick={() => setEditRule(null)}
								disabled={updateMutation.isPending}
							>
								Cancel
							</Button>
							<Button
								onClick={handleSaveEdit}
								disabled={updateMutation.isPending || editContent.trim().length === 0}
							>
								Save
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<AlertDialog open={!!ruleToDelete} onOpenChange={() => setRuleToDelete(null)}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete rule?</AlertDialogTitle>
							<AlertDialogDescription>
								This rule will be removed and no longer applied to your chats.
							</AlertDialogDescription>
						</AlertDialogHeader>
						{deleteMutation.error?.message && <ErrorMessage message={deleteMutation.error.message} />}
						<AlertDialogFooter>
							<AlertDialogCancel variant='outline' size='sm' disabled={deleteMutation.isPending}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								variant='destructive'
								size='sm'
								onClick={handleConfirmDelete}
								disabled={deleteMutation.isPending}
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</SettingsCard>
		</>
	);
}

interface RuleItemProps {
	rule: UserRule;
	onEdit: () => void;
	onDelete: () => void;
	className?: string;
}

function RuleItem({ rule, onEdit, onDelete, className }: RuleItemProps) {
	return (
		<div className={cn('flex items-center gap-4 py-2 group', className)}>
			<div className='flex-1 min-w-0 space-y-1 text-sm text-foreground line-clamp-2'>{rule.content}</div>
			<div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'>
				<Button variant='ghost-muted' size='icon-sm' onClick={onEdit}>
					<Pencil />
				</Button>
				<Button variant='ghost-muted' size='icon-sm' onClick={onDelete}>
					<Trash2 />
				</Button>
			</div>
		</div>
	);
}

function RuleSkeleton({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-start gap-4 py-2', className)}>
			<div className='flex-1 min-w-0 space-y-2'>
				<Skeleton className='h-3 w-full max-w-xs' />
			</div>
		</div>
	);
}
