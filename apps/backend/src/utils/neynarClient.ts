import { NeynarAPIClient } from "@neynar/nodejs-sdk";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.NEYNAR_API_KEY) {
  throw new Error("NEYNAR_API_KEY is required in environment variables");
}
const apiKey = process.env.NEYNAR_API_KEY;
const neynarClient = new NeynarAPIClient({ apiKey });

export default neynarClient;
