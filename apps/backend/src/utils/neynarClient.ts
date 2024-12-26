import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

// Check if the NEYNAR_API_KEY environment variable is available
if (!process.env.NEYNAR_API_KEY) {
  throw new Error("Make sure you set NEYNAR_API_KEY in your .env file");
}

// Create the configuration object to pass to the NeynarAPIClient
const config: Configuration = {
  apiKey: process.env.NEYNAR_API_KEY!, // Get the API key from environment variables
};

const neynarClient = new NeynarAPIClient(config); // Initialize the client with the configuration object

export default neynarClient;
