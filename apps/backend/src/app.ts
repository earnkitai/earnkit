import express from 'express';
import cors from 'cors';
import routes from './routes';
import cron from 'node-cron';
import { fetchAndDeployTokens } from './services/fetchAndDeploy';

const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    optionsSuccessStatus: 204,
  }),
);

// Enable pre-flight for all routes
app.options('*', cors());

app.use(express.json());

// All routes under /api
app.use('/api', routes);
console.log('Starting Token Suggestion API...');

// Fetch and store token every 20 second
cron.schedule('*/20 * * * * *', fetchAndDeployTokens);

// // Fetch and store tokens every 24 hours (Runs at midnight UTC daily)
// cron.schedule('0 0 * * *', fetchAndStoreTokens);

const PORT = process.env.PORT || 3000; // Default to 3000 if not set in the environment
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
