import "dotenv/config";
import { writeFileSync } from "fs";
import { toSafeSmartAccount } from "permissionless/accounts"; // using permissionless.js for safe accounts
import { Address, Hex, createPublicClient, getContract, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
  createBundlerClient,
  entryPoint07Address,
} from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { parseAbiItem, encodeFunctionData } from "viem";

const apiKey = process.env.PIMLICO_API_KEY;
if (!apiKey) throw new Error("Missing PIMLICO_API_KEY");

const privateKey =
  (process.env.PRIVATE_KEY as Hex) ??
  (() => {
    console.log("creating new PVT_KEY");
    const pk = generatePrivateKey();
    writeFileSync(".env", `PRIVATE_KEY=${pk}`);
    return pk;
  })();

export const publicClient = createPublicClient({
  // justa normal viem client
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});

const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${apiKey}`; // bundler URL

const pimlicoClient = createPimlicoClient({
  // pimlico client
  transport: http(pimlicoUrl),
  entryPoint: {
    address: entryPoint07Address,
    version: "0.7",
  },
});
// const account = await toSafeSmartAccount({		// toSafeSmartAccount from permissionless.js
// 	client: publicClient,
// 	owners: [privateKeyToAccount(privateKey)],
// 	entryPoint: {
// 		address: entryPoint07Address,			// standard / global Entrypoint address.
// 		version: "0.7",
// 	}, 		// global entrypoint
// 	version: "1.4.1",
// })
const mintToken = async (ownerAddress: Address) => {
  console.log("Owner Address :- ", ownerAddress);
  const account = await toSafeSmartAccount({
    client: publicClient,
    entryPoint: {
      address: entryPoint07Address,
      version: "0.7",
    },
    owners: [privateKeyToAccount(privateKey)],
    saltNonce: BigInt(1000), // optional
    version: "1.4.1",
    address: "0xC00a592d372a20f7af237b3107c33B54e6764C63",
    // c // optional, only if you are using an already created account
  });

  console.log("safe address", account.address);

  //  console.log(account);
  // // console.log(`Smart account address: https://sepolia.etherscan.io/address/${account.address}`)
  // console.log(`Smart account address: https://sepolia.basescan.org/address/${account.address}`)

  const smartAccountClient = createSmartAccountClient({
    // createSmartAccountClient replaces walletClient by viem
    account, // but for smart accounts.
    chain: baseSepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  //   const txHash = await smartAccountClient.sendTransaction({
  //     to: "0x625F89D17B2AaDA73CD3b31C19607Abe8E970bbC",
  //     value: BigInt(1000000000000),
  //     data: "0x1234",
  //   });

  //   const args: [
  //       string, // _name
  //       string, // _symbol
  //       bigint, // _supply
  //       number, // _initialTick
  //       number, // _poolFee
  //       `0x${string}`, // _salt
  //       `0x${string}` // _deployer
  //   ] = [
  //       "Earnkit",
  //       "EKT",
  //       100000000000000000000000000000n, // bigint for _supply
  //       -230400, // number for _initialTick
  //       10000, // number for _poolFee
  //       "0x0000000000000000000000000000000000000000000000000000000000000003", // valid `0x${string}` type for _salt
  //       "0x625F89D17B2AaDA73CD3b31C19607Abe8E970bbC" // valid `0x${string}` type for _deployer
  //   ];
  //     const txHash = await smartAccountClient.sendTransaction({
  //         to: "0xD36dEdc2e2fd6BD1d3B8ec9B62549c1D6faF931F",
  //         data: encodeFunctionData({
  //             abi: [parseAbiItem('function deployToken(string calldata _name,string calldata _symbol,uint256 _supply,int24 _initialTick,uint24 _poolFee,bytes32 _salt,address _deployer) external payable')],
  //             functionName: "deployToken", // Comma added here
  //             args,
  //         }),
  //         value: 0n,

  //   });

  const args: [string, string, bigint, `0x${string}`] = [
    "Earnkit",
    "EKT",
    BigInt(100000000 * 18),
    ownerAddress,
  ];
  const txHash = await smartAccountClient.sendTransaction({
    to: "0x362EEAa2584Ba571F7F853F39460b867d4588bb2",
    data: encodeFunctionData({
      abi: [
        parseAbiItem(
          "function createToken(string memory name, string memory symbol, uint256 initialSupply,address _ownerAddress)"
        ),
      ],
      functionName: "createToken", // Comma added here
      args,
    }),
    value: BigInt(0),
  });

  console.log(
    `User operation included: https://sepolia.basescan.org/tx/${txHash}`
  );
  return txHash;
  //0x4337011463EF6BD863E47E7b5E743D2522261131 bundler
  //0x0000000071727De22E5E9d8BAf0edAc6f37da032 entry point
};

export default mintToken;
