export function ErrorMessage({ message }: { message: string }) {
	return <div className='text-sm text-destructive p-3 bg-destructive/10 rounded-md'>{message}</div>;
}
