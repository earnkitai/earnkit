import { Request, Response } from "express";
import { NeynarAPIClient } from "@neynar/nodejs-sdk";
import neynarClient from "../utils/neynarClient";
import mintToken from "../utils/deployToken";
// import { NeynarFrameCreationRequest } from "@neynar/nodejs-sdk";

export const deployToken = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const hookData = req.body;

    // Check for specific keywords in the cast text
    const authorUsername = hookData.data.author.username;
    const castHash = hookData.data.hash;
    const castText = hookData.data.text;
    const ownerAddress =
      hookData.data.author.verified_addresses.eth_addresses[0] ||
      hookData.data.author.custody_address;
    console.log("Webhook Event Received:", ownerAddress);
    res.status(201).json({
      success: true,
      data: "hale luya",
    });

    if (castText && castText.includes("0xshinchain")) {
      try {
        // Deploy token call
        // const txHash = await mintToken(ownerAddress);
        // console.log("Token minted with transaction hash:", txHash);

        try {
          // Create a custom frame on the fly
          const frameUrl = await createFrame(authorUsername);
          console.log("Frame created with URL:", frameUrl);

          try {
            // Send a reply with the custom frame
            const reply = await neynarClient.publishCast({
              signerUuid: process.env.SIGNER_UUID!,
              text: `Your token is deployed! Check it here: https://sepolia.basescan.org/tx/`,
              parent: castHash,
              embeds: [
                {
                  url: frameUrl,
                },
              ],
            });
            console.log("Reply Sent:", reply);
          } catch (replyError: any) {
            console.error("Error sending reply:", replyError.message);
          }
        } catch (frameError: any) {
          console.error("Error creating frame:", frameError.message);
        }
      } catch (mintError: any) {
        console.error("Error minting token:", mintError.message);
      }
    }
  } catch (e: any) {
    console.error("Error processing webhook:", e.message);
    res.status(400).json({
      success: false,
      error: "hale error",
    });
  }
};

// Function to create a custom frame
async function createFrame(authorUsername: string) {
  const creationRequest: any = {
    name: `gm ${authorUsername}`,
    pages: [
      {
        image: {
          url: "https://moralis.io/wp-content/uploads/web3wiki/638-gm/637aeda23eca28502f6d3eae_61QOyzDqTfxekyfVuvH7dO5qeRpU50X-Hs46PiZFReI.jpeg",
          aspect_ratio: "1:1",
        },
        title: "Page title",
        buttons: [],
        input: {
          text: {
            enabled: false,
          },
        },
        uuid: "gm",
        version: "vNext",
      },
    ],
  };

  const frame = await neynarClient.publishNeynarFrame(creationRequest);

  try {
    const frame = await neynarClient.publishNeynarFrame(creationRequest);
    console.log("Frame Created:", frame);
    return frame.link;
  } catch (error) {
    console.error("Error creating frame:", error);
    throw new Error("Failed to create frame");
  }
}
