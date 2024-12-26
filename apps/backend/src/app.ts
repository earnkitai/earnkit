import express from "express";
import cors from "cors";
import publicRoutes from "./routes/publicRoutes";
import privateRoutes from "./routes/privateRoutes";
import pool from "./config/database";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        subscription: string;
      };
    }
  }
}

const app = express();

app.use(cors());
app.use(express.json());

// Test database connection
pool
  .connect()
  .then(() => console.log("PostgreSQL connected successfully"))
  .catch((err) => {
    console.error("PostgreSQL connection error:", err);
    process.exit(1);
  });

// Routes
app.use("/api/public", publicRoutes);
// Private routes (API key validation is applied here)
app.use("/api/private", privateRoutes);

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({
      success: false,
      error: "Something went wrong!",
    });
  }
);
const PORT = process.env.PORT || 3000; // Default to 3000 if not set in the environment
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
