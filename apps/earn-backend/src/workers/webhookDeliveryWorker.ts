import { createHmac } from 'crypto';
import { prisma } from '../lib/prisma';

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 3;
// Back-off: attempt N waits N minutes before retry
const RETRY_DELAY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

function buildSignature(secret: string, timestamp: number, payload: string): string {
  const message = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

async function processPendingDeliveries(): Promise<void> {
  const now = new Date();

  const pending = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { endpoint: { select: { url: true, secret: true, enabled: true } } },
  });

  if (pending.length === 0) return;

  console.log(`[WebhookWorker] Delivering ${pending.length} pending webhook(s)`);

  for (const delivery of pending) {
    if (!delivery.endpoint.enabled) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'CANCELLED' },
      });
      continue;
    }

    const attempt = delivery.attempts + 1;
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadStr = JSON.stringify(delivery.payload);
    const signature = buildSignature(delivery.endpoint.secret, timestamp, payloadStr);

    try {
      const response = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EarnKit-Signature': `t=${timestamp},v1=${signature}`,
          'X-EarnKit-Event': delivery.eventType,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const responseBody = await response.text().catch(() => '');
      const isFinal = attempt >= MAX_ATTEMPTS;

      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'DELIVERED',
            responseStatus: response.status,
            responseBody: responseBody.slice(0, 1000),
            attempts: attempt,
            deliveredAt: new Date(),
            lastError: null,
          },
        });
        console.log(`[WebhookWorker] Delivered ${delivery.id} to ${delivery.endpoint.url}`);
      } else {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: isFinal ? 'FAILED' : 'PENDING',
            responseStatus: response.status,
            responseBody: responseBody.slice(0, 1000),
            attempts: attempt,
            lastError: `HTTP ${response.status}`,
            nextAttemptAt: isFinal ? null : new Date(Date.now() + attempt * RETRY_DELAY_MS),
          },
        });
      }
    } catch (err: any) {
      const isFinal = attempt >= MAX_ATTEMPTS;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          attempts: attempt,
          lastError: err?.message ?? 'Network error',
          nextAttemptAt: isFinal ? null : new Date(Date.now() + attempt * RETRY_DELAY_MS),
        },
      });
      console.error(`[WebhookWorker] Failed delivery ${delivery.id}:`, err?.message);
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startWebhookDeliveryWorker(): void {
  if (intervalHandle) return;
  console.log(`[WebhookWorker] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  processPendingDeliveries().catch((e) =>
    console.error('[WebhookWorker] Initial run error:', e),
  );
  intervalHandle = setInterval(() => {
    processPendingDeliveries().catch((e) =>
      console.error('[WebhookWorker] Poll error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopWebhookDeliveryWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
