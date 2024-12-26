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

    if (castText && castText.includes("0xshinchain")) {
      // deploy token call

      const txHash = await mintToken(ownerAddress);
      // Create a custom frame on the fly
      const frameUrl = await createFrame(authorUsername);

      // Send a reply with the custom frame
      const reply = await neynarClient.publishCast({
        signerUuid: process.env.SIGNER_UUID!,
        text: `your token is deployed https://sepolia.basescan.org/tx/${txHash}`,
        parent: castHash,
        embeds: [
          {
            url: frameUrl,
          },
        ],
      });

      console.log("Reply Sent:", reply);
    }

    res.status(201).json({
      success: true,
      data: "hale luya",
    });
    // return new Response("Webhook received!", { status: 200 });
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
