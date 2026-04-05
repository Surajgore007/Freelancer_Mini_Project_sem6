import { JsonRpcProvider, Contract, Wallet } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS;
  const arbiterAddresses = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);

  if (!rpcUrl) {
    throw new Error("Missing required environment variable: RPC_URL or SEPOLIA_RPC_URL");
  }

  if (!privateKey) {
    throw new Error("Missing required environment variable: DEPLOYER_PRIVATE_KEY");
  }

  if (!contractAddress) {
    throw new Error("Missing required environment variable: CONTRACT_ADDRESS or VITE_CONTRACT_ADDRESS");
  }

  if (arbiterAddresses.length === 0) {
    throw new Error("Pass at least one arbiter wallet address as a command argument.");
  }

  const abi = JSON.parse(
    readFileSync(resolve("frontend/src/config/abi.json"), "utf8"),
  );

  const provider = new JsonRpcProvider(rpcUrl);
  const ownerWallet = new Wallet(normalizePrivateKey(privateKey), provider);
  const contract = new Contract(contractAddress, abi, ownerWallet);

  console.log("Owner:", await ownerWallet.getAddress());
  console.log("Contract:", contractAddress);

  for (const arbiter of arbiterAddresses) {
    const tx = await contract.setBootstrapArbiter(arbiter, true);
    console.log(`Approving bootstrap arbiter: ${arbiter}`);
    console.log(`TX: ${tx.hash}`);
    await tx.wait();
  }

  console.log("Bootstrap approval complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
