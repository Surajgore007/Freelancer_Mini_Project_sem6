import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

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
  const chainId = Number.parseInt(
    process.env.TARGET_CHAIN_ID || process.env.SEPOLIA_CHAIN_ID || "11155111",
    10,
  );
  const networkName = process.env.TARGET_NETWORK_NAME || process.env.SEPOLIA_NETWORK_NAME || "Sepolia";

  if (!rpcUrl) {
    throw new Error("Missing required environment variable: RPC_URL or SEPOLIA_RPC_URL");
  }
  if (!privateKey) {
    throw new Error("Missing required environment variable: DEPLOYER_PRIVATE_KEY");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(normalizePrivateKey(privateKey), provider);
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== chainId) {
    throw new Error(
      `RPC network chain ID ${network.chainId.toString()} does not match expected chain ID ${chainId}.`,
    );
  }

  const artifactPath = resolve("artifacts/contracts/FreelancerEscrow.sol/FreelancerEscrow.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const deployedAddress = await contract.getAddress();
  const frontendEnvBlock = [
    `VITE_CONTRACT_ADDRESS=${deployedAddress}`,
    `VITE_CHAIN_ID=${chainId}`,
    `VITE_NETWORK_NAME=${networkName}`,
  ].join("\n");

  if (process.env.WRITE_FRONTEND_ENV === "true") {
    const frontendEnvPath = resolve("frontend/.env.production.local");
    await writeFile(frontendEnvPath, `${frontendEnvBlock}\n`, "utf8");
    console.log("frontend production env written to:", frontendEnvPath);
  }

  console.log("FreelancerEscrow deployed to:", deployedAddress);
  console.log("Deployer:", await wallet.getAddress());
  console.log("Network:", `${networkName} (${chainId})`);
  console.log("");
  console.log("Set these Vercel environment variables:");
  console.log(frontendEnvBlock);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
