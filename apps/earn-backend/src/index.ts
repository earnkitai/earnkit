import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { startTopUpVerificationWorker } from './workers/topUpVerificationWorker';
import { startPaymentIntentVerifierWorker } from './workers/paymentIntentVerifierWorker';
import { startWebhookDeliveryWorker } from './workers/webhookDeliveryWorker';
import { startBuybackExecutorWorker } from './workers/buybackExecutorWorker';
import { startSharedSplitBuybackWorker } from './workers/sharedSplitBuybackWorker';
import { startTokenBuybackWorker } from './workers/tokenBuybackWorker';
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
app.listen(PORT, () => {
  console.log(`EarnKit Backend API running on port ${PORT}`);
  startTopUpVerificationWorker();
  startPaymentIntentVerifierWorker();
  startWebhookDeliveryWorker();
  startBuybackExecutorWorker();
  startSharedSplitBuybackWorker();
  startTokenBuybackWorker();
  logOperatorWalletStatus().catch(() => {});
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export default app;
