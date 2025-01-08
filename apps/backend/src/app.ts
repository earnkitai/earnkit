import express from 'express';
import cors from 'cors';
import publicRoutes from './routes/publicRoutes';
import privateRoutes from './routes/privateRoutes';
import pool from './config/database';

// declare global {
//   namespace Express {
//     interface Request {
//       user?: {
//         address: string;
//       };
//     }
//   }
// }

const app = express();

app.use(cors());
app.use(express.json());

pool
  .connect()
  .then(() => console.log('PostgreSQL connected successfully'))
  .catch((err) => {
    console.error('PostgreSQL connection error:', err);
    process.exit(1);
  });

// Routes
app.use('/api/public', publicRoutes);

app.use('/api/private', privateRoutes);

const PORT = process.env.PORT || 3000; // Default to 3000 if not set in the environment
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
