export function getRunStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
	if (status === 'failed') {
		return 'destructive';
	}
	if (status === 'cancelled') {
		return 'outline';
	}
	return 'secondary';
}
