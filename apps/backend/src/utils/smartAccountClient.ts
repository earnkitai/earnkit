import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createAccount } from "@turnkey/viem";
import { Turnkey } from "@turnkey/sdk-server";
import { http } from "viem";
import { baseSepolia } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { publicClient } from "../controllers/private/turnkey.controller";

export const createClient = async (config: any) => {
  const turnkeyServer = new Turnkey({
    apiBaseUrl: "https://api.turnkey.com",
    apiPrivateKey: process.env.ORG_PRIVATE_KEY as string,
    apiPublicKey: process.env.ORG_PUBLIC_KEY as string,
    defaultOrganizationId: config.wallet.organizationId,
  }).apiClient();

  const turnkeyAccount = await createAccount({
    client: turnkeyServer,
    organizationId: config.wallet.organizationId,
    signWith: config.wallet.signWith,
  });

  const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
  });

  const account = await toSafeSmartAccount({
    client: publicClient,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
    owners: [turnkeyAccount],
    saltNonce: BigInt(config.account.saltNonce),
    version: "1.4.1",
    address: config.account.address as `0x${string}`,
  });

  return createSmartAccountClient({
    account,
    chain: baseSepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });
};
