import type { App } from '../app';
import { env } from '../env';
import { STRIPE_WEBHOOK_PROCESS_JOB_NAME } from '../handlers/stripe-webhook.handler';
import * as billingQueries from '../queries/billing.queries';
import { enqueueOnce } from '../services/scheduler.service';
import { getStripeClient } from '../services/stripe.service';
import { logger } from '../utils/logger';

export const stripeWebhookRoutes = async (app: App) => {
	app.post('/', { config: { rawBody: true } }, async (request, reply) => {
		const signatureHeader = request.headers['stripe-signature'];
		const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
		const stripeConfig = env.STRIPE_CONFIG;
		if (!signature || !request.rawBody || !stripeConfig) {
			return reply.status(400).send({ error: 'Invalid Stripe webhook request' });
		}

		let event;
		try {
			event = await getStripeClient().webhooks.constructEventAsync(
				request.rawBody as string,
				signature,
				stripeConfig.webhookSecret,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn(`Stripe webhook signature rejected: ${message}`, { source: 'system' });
			return reply.status(400).send({ error: 'Invalid Stripe webhook signature' });
		}

		if (event.livemode !== /^[rs]k_live_/.test(stripeConfig.secretKey)) {
			return reply.status(400).send({ error: 'Stripe event mode does not match the configured Stripe key' });
		}

		const stripeObject = event.data.object as { id?: string };
		await billingQueries.insertStripeWebhookEvent({
			id: event.id,
			type: event.type,
			stripeObjectId: stripeObject.id,
			livemode: event.livemode,
		});
		await enqueueOnce({
			name: STRIPE_WEBHOOK_PROCESS_JOB_NAME,
			payload: { eventId: event.id },
			uniqueKey: `stripe-event:${event.id}`,
			maxAttempts: 10,
		});

		return reply.status(200).send({ received: true });
	});
};
