export function stripeId(value: string | { id: string } | null): string {
	if (!value) {
		throw new Error('Stripe object reference is missing');
	}
	return typeof value === 'string' ? value : value.id;
}
