import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { startTopUpVerificationWorker, stopTopUpVerificationWorker } from './workers/topUpVerificationWorker';
import { startPaymentIntentVerifierWorker, stopPaymentIntentVerifierWorker } from './workers/paymentIntentVerifierWorker';
import { startWebhookDeliveryWorker, stopWebhookDeliveryWorker } from './workers/webhookDeliveryWorker';
import { startBuybackExecutorWorker, stopBuybackExecutorWorker } from './workers/buybackExecutorWorker';
import { startSharedSplitBuybackWorker, stopSharedSplitBuybackWorker } from './workers/sharedSplitBuybackWorker';
import { logOperatorWalletStatus } from './lib/operatorGas';

// Load environment variables — explicit path so it works regardless of CWD
// (monorepo root vs package directory)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Catch async errors that escape Express middleware so one bad request
// doesn't take down the whole process. Logged loudly; do not exit.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Synchronous errors usually mean state is corrupted — log and exit so the
// container restarts cleanly. Railway's restart policy will bring it back.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS — allow only explicitly listed origins via CORS_ALLOWED_ORIGINS env var.
// This API is primarily server-to-server; browser origins must be opted in.
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no Origin header)
      if (!origin) return callback(null, true);
      // Wildcard — allow any origin
      if (allowedOrigins.includes('*')) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: false,
  }),
);

// Request logging
app.use(morgan('combined'));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'EarnKit Backend API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API routes
app.use('/api', routes);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log(`EarnKit Backend API running on port ${PORT}`);
  startTopUpVerificationWorker();
  startPaymentIntentVerifierWorker();
  startWebhookDeliveryWorker();
  startBuybackExecutorWorker();
  startSharedSplitBuybackWorker();
  logOperatorWalletStatus().catch(() => {});
});

// Graceful shutdown — see docs/06_RELIABILITY_FIXES_2026_05_14.md §7.
const SHUTDOWN_GRACE_MS = parseInt(process.env.SHUTDOWN_GRACE_MS ?? '15000', 10);
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${signal}] graceful shutdown starting (grace ${SHUTDOWN_GRACE_MS}ms)`);

  // Stop new work entering the workers.
  try { stopTopUpVerificationWorker(); } catch (e) { console.error('stop topUp:', e); }
  try { stopPaymentIntentVerifierWorker(); } catch (e) { console.error('stop PIVerifier:', e); }
  try { stopWebhookDeliveryWorker(); } catch (e) { console.error('stop webhook:', e); }
  try { stopBuybackExecutorWorker(); } catch (e) { console.error('stop buyback exec:', e); }
  try { stopSharedSplitBuybackWorker(); } catch (e) { console.error('stop sharedSplit:', e); }

  // Stop accepting new HTTP connections; existing requests drain.
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Best-effort: let in-flight worker tasks finish. We cannot await them
  // directly (the workers don't expose a barrier), so we time-box.
  await new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS));

  console.log(`[${signal}] graceful shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

export default app;
