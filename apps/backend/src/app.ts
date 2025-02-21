import express from 'express';
import cors from 'cors';
import routes from './routes';

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

const PORT = process.env.PORT || 3000; // Default to 3000 if not set in the environment
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
