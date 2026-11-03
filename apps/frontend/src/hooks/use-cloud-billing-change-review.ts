import { useEffect, useState } from 'react';
import { TEAM_MAX_SEATS, TEAM_MIN_SEATS } from '@nao/shared/billing';

import type { CloudBillingChangePreview } from '@/components/settings/cloud-billing-change-preview';

export type CloudBillingChangeReview = ReturnType<typeof useCloudBillingChangeReview>;

/** Confirmation is only offered for a preview that matches the current inputs and whose token has not expired. */
export function useCloudBillingChangeReview({
	open,
	resetKey,
	initialSeatInput = '',
	requiresSeats,
	errorMessages,
	onPreview,
	onConfirm,
	onDone,
}: {
	open: boolean;
	resetKey: string;
	initialSeatInput?: string;
	requiresSeats: boolean;
	errorMessages: { preview: string; confirm: string };
	onPreview: (seatQuantity: number | null, promotionCode: string | undefined) => Promise<CloudBillingChangePreview>;
	onConfirm: (preview: NonNullable<CloudBillingChangePreview>) => Promise<unknown>;
	onDone: () => void;
}) {
	const [seatInput, setSeatInput] = useState(initialSeatInput);
	const [promotionCode, setPromotionCode] = useState('');
	const [preview, setPreview] = useState<CloudBillingChangePreview>(null);
	const [reviewedSeats, setReviewedSeats] = useState<number | null>(null);
	const [reviewedPromotionCode, setReviewedPromotionCode] = useState('');
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setSeatInput(initialSeatInput);
			setPromotionCode('');
			setPreview(null);
			setReviewedSeats(null);
			setReviewedPromotionCode('');
			setError(null);
		}
	}, [open, resetKey, initialSeatInput]);

	const seatQuantity = requiresSeats ? parseTeamSeatQuantity(seatInput) : null;
	const normalizedPromotionCode = promotionCode.trim();
	const inputsReviewed =
		preview !== null && reviewedSeats === seatQuantity && reviewedPromotionCode === normalizedPromotionCode;
	const reviewedPreview = inputsReviewed ? preview : null;
	const expired = preview ? preview.expiresAt.getTime() <= Date.now() : false;
	const appliedPromotion =
		reviewedPreview?.promotionCodeDiscount && reviewedPromotionCode
			? {
					code: reviewedPromotionCode,
					currency: reviewedPreview.currency,
					...reviewedPreview.promotionCodeDiscount,
				}
			: null;

	const run = async <T>(action: () => Promise<T>, failureMessage: string) => {
		setIsPending(true);
		setError(null);
		try {
			return { data: await action(), error: null };
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : failureMessage;
			setError(message);
			return { data: null, error: message };
		} finally {
			setIsPending(false);
		}
	};

	const review = async () => {
		if (requiresSeats && seatQuantity === null) {
			return;
		}
		await run(async () => {
			setPreview(await onPreview(seatQuantity, normalizedPromotionCode || undefined));
			setReviewedSeats(seatQuantity);
			setReviewedPromotionCode(normalizedPromotionCode);
		}, errorMessages.preview);
	};

	const confirm = async () => {
		if (!reviewedPreview || expired) {
			return;
		}
		const { error: failure } = await run(() => onConfirm(reviewedPreview), errorMessages.confirm);
		if (!failure) {
			onDone();
		}
		if (failure?.toLowerCase().includes('preview')) {
			setPreview(null);
		}
	};

	const runAndClose = (action: () => Promise<unknown>, failureMessage: string) =>
		run(async () => {
			await action();
			onDone();
		}, failureMessage);

	return {
		seatInput,
		seatQuantity,
		setSeatInput: (value: string) => {
			setSeatInput(value.replace(/\D/g, '').slice(0, 2));
			setError(null);
		},
		promotionCode,
		promotionCodeChanged: normalizedPromotionCode !== reviewedPromotionCode,
		setPromotionCode: (value: string) => {
			setPromotionCode(value);
			setError(null);
		},
		reviewedPreview,
		canConfirm: reviewedPreview !== null && !expired,
		expired: inputsReviewed && expired,
		appliedPromotion,
		isPending,
		error,
		review,
		confirm,
		runAndClose,
	};
}

function parseTeamSeatQuantity(input: string): number | null {
	const quantity = Number(input);
	return input !== '' && Number.isInteger(quantity) && quantity >= TEAM_MIN_SEATS && quantity <= TEAM_MAX_SEATS
		? quantity
		: null;
}
