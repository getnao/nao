import { Input } from '@/components/ui/input';

type AnyForm = any;

interface TextFieldProps {
	form: AnyForm;
	name: string;
	label: string;
	type?: string;
	placeholder?: string;
	hint?: string;
	required?: boolean;
}

export function TextField({ form, name, label, type = 'text', placeholder, hint, required = false }: TextFieldProps) {
	return (
		<form.Field
			name={name}
			validators={
				required ? { onChange: ({ value }: { value: string }) => (!value ? 'Required' : undefined) } : undefined
			}
		>
			{(field: {
				state: { value: string; meta: { errors: string[] } };
				handleChange: (v: string) => void;
				handleBlur: () => void;
			}) => (
				<div className='grid gap-2'>
					<label htmlFor={name} className='text-sm font-medium text-foreground'>
						{label}
						{hint && <span className='text-muted-foreground font-normal ml-1'>{hint}</span>}
					</label>
					<Input
						id={name}
						name={name}
						type={type}
						placeholder={placeholder}
						value={field.state.value ?? ''}
						onChange={(e) => field.handleChange(e.target.value)}
						onBlur={field.handleBlur}
					/>
					{field.state.meta.errors.length > 0 && (
						<p className='text-xs text-destructive'>{field.state.meta.errors[0]}</p>
					)}
				</div>
			)}
		</form.Field>
	);
}

interface PasswordFieldProps {
	form: AnyForm;
	name: string;
	label: string;
	placeholder?: string;
	hint?: string;
	required?: boolean;
}

export function PasswordField({ form, name, label, placeholder, hint, required = false }: PasswordFieldProps) {
	return (
		<TextField
			form={form}
			name={name}
			label={label}
			type='password'
			placeholder={placeholder}
			hint={hint}
			required={required}
		/>
	);
}

interface FormErrorProps {
	error?: string;
	form?: AnyForm;
}

type FormLevelError = string | { form?: string; fields?: Record<string, string> } | undefined;

export function FormError({ error, form }: FormErrorProps) {
	// If form is provided, subscribe to form-level errors
	if (form) {
		return (
			<form.Subscribe selector={(state: { errorMap: { onSubmit?: FormLevelError } }) => state.errorMap.onSubmit}>
				{(formError: FormLevelError) => {
					// Extract error message from either string or object format
					const formErrorMessage = typeof formError === 'string' ? formError : formError?.form;
					const displayError = error || formErrorMessage;
					if (!displayError) {
						return null;
					}
					return <p className='text-red-500 text-center text-base'>{displayError}</p>;
				}}
			</form.Subscribe>
		);
	}

	// Fallback for standalone error prop
	if (!error) {
		return null;
	}
	return <p className='text-red-500 text-center text-base'>{error}</p>;
}

interface FormActionsProps {
	form: AnyForm;
	submitText: string;
	onCancel?: () => void;
	showCancel?: boolean;
	isPending?: boolean;
	submitIcon?: React.ReactNode;
}

export function FormActions({
	form,
	submitText,
	onCancel,
	showCancel = true,
	isPending = false,
	submitIcon,
}: FormActionsProps) {
	return (
		<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
			{(canSubmit: boolean) => (
				<div className='flex justify-end gap-2'>
					{showCancel && onCancel && (
						<button
							type='button'
							onClick={onCancel}
							className='px-3 py-1.5 text-sm font-medium rounded-md hover:bg-muted transition-colors'
						>
							Cancel
						</button>
					)}
					<button
						type='submit'
						disabled={!canSubmit || isPending}
						className='inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
					>
						{submitIcon}
						{submitText}
					</button>
				</div>
			)}
		</form.Subscribe>
	);
}
