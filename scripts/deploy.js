import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ContractFactory, JsonRpcProvider, parseEther } from "ethers";

async function waitFor(txPromise) {
  const tx = await txPromise;
  await tx.wait();
  return tx;
}

async function latestTimestamp(provider) {
  const block = await provider.getBlock("latest");
  return Number(block?.timestamp ?? Math.floor(Date.now() / 1000));
}

async function increaseTime(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");

  const actors = {
    deployer: await provider.getSigner(0),
    clientAtlas: await provider.getSigner(1),
    freelancerMaya: await provider.getSigner(2),
    clientNova: await provider.getSigner(3),
    freelancerLeo: await provider.getSigner(4),
    bootstrapAva: await provider.getSigner(5),
    bootstrapIris: await provider.getSigner(6),
    bootstrapRhett: await provider.getSigner(7),
    clientOrbit: await provider.getSigner(8),
    freelancerZane: await provider.getSigner(9),
  };

  const addresses = {};
  for (const [label, signer] of Object.entries(actors)) {
    addresses[label] = await signer.getAddress();
  }
  const signerByAddress = Object.fromEntries(
    Object.entries(addresses).map(([label, address]) => [address.toLowerCase(), actors[label]]),
  );

  const artifactPath = resolve("artifacts/contracts/FreelancerEscrow.sol/FreelancerEscrow.json");
  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, actors.deployer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const createJob = async (
    clientSigner,
    freelancerAddress,
    title,
    termsURI,
    paymentEth,
    clientStakeEth,
    freelancerStakeEth,
    deliveryOffsetSeconds,
    reviewHours,
  ) => {
    const paymentAmount = parseEther(paymentEth);
    const clientStake = parseEther(clientStakeEth);
    const freelancerStake = parseEther(freelancerStakeEth);
    const reviewPeriod = BigInt(reviewHours * 3600);
    const deadline = BigInt((await latestTimestamp(provider)) + deliveryOffsetSeconds);

    await waitFor(
      contract.connect(clientSigner).createJob(
        freelancerAddress,
        title,
        termsURI,
        paymentAmount,
        clientStake,
        freelancerStake,
        deadline,
        reviewPeriod,
        { value: paymentAmount + clientStake },
      ),
    );

    return Number(await contract.jobCount());
  };

  const bootstrapArbiters = [actors.bootstrapAva, actors.bootstrapIris, actors.bootstrapRhett];

  for (const signer of bootstrapArbiters) {
    await waitFor(contract.connect(actors.deployer).setBootstrapArbiter(await signer.getAddress(), true));
    await waitFor(contract.connect(signer).depositArbiterStake({ value: parseEther("0.12") }));
  }

  const job1 = await createJob(
    actors.clientAtlas,
    addresses.freelancerMaya,
    "SaaS Landing Page Build",
    "https://demo.escrow/terms/saas-landing-v1.json",
    "0.90",
    "0.12",
    "0.10",
    5 * 24 * 3600,
    24,
  );
  await waitFor(contract.connect(actors.freelancerMaya).acceptJob(job1, { value: parseEther("0.10") }));
  await waitFor(contract.connect(actors.freelancerMaya).submitWork(job1, "https://demo.escrow/work/saas-landing-final"));
  await waitFor(contract.connect(actors.clientAtlas).approveWork(job1));

  await waitFor(contract.connect(actors.clientAtlas).depositArbiterStake({ value: parseEther("0.06") }));
  await waitFor(contract.connect(actors.freelancerMaya).depositArbiterStake({ value: parseEther("0.08") }));

  const job2 = await createJob(
    actors.clientNova,
    addresses.freelancerLeo,
    "Brand Identity Starter Pack",
    "https://demo.escrow/terms/brand-identity-pack.json",
    "1.35",
    "0.18",
    "0.12",
    6 * 24 * 3600,
    1,
  );
  await waitFor(contract.connect(actors.freelancerLeo).acceptJob(job2, { value: parseEther("0.12") }));
  await waitFor(contract.connect(actors.freelancerLeo).submitWork(job2, "https://demo.escrow/work/brand-identity-files"));
  await increaseTime(provider, 2 * 3600);
  await waitFor(contract.connect(actors.bootstrapAva).autoRelease(job2));

  await waitFor(contract.connect(actors.clientNova).depositArbiterStake({ value: parseEther("0.06") }));

  const job3 = await createJob(
    actors.clientOrbit,
    addresses.freelancerZane,
    "Three-Screen Mobile Flow",
    "https://demo.escrow/terms/mobile-flow.json",
    "0.58",
    "0.08",
    "0.08",
    4 * 24 * 3600,
    24,
  );

  const job4 = await createJob(
    actors.clientOrbit,
    addresses.freelancerMaya,
    "Investor Pitch Deck Refresh",
    "https://demo.escrow/terms/pitch-deck-refresh.json",
    "0.72",
    "0.09",
    "0.08",
    3 * 24 * 3600,
    24,
  );
  await waitFor(contract.connect(actors.freelancerMaya).acceptJob(job4, { value: parseEther("0.08") }));

  const job5 = await createJob(
    actors.clientAtlas,
    addresses.freelancerLeo,
    "Product Explainer Page",
    "https://demo.escrow/terms/explainer-page.json",
    "1.10",
    "0.16",
    "0.14",
    5 * 24 * 3600,
    36,
  );
  await waitFor(contract.connect(actors.freelancerLeo).acceptJob(job5, { value: parseEther("0.14") }));
  await waitFor(contract.connect(actors.freelancerLeo).submitWork(job5, "https://demo.escrow/work/explainer-page-v1"));
  await waitFor(contract.connect(actors.clientAtlas).raiseDispute(job5, "https://demo.escrow/dispute/explainer-page-proof"));

  const dispute5 = await contract.getDispute(job5);
  await waitFor(contract.connect(signerByAddress[dispute5.jurors[0].toLowerCase()]).voteOnDispute(job5, true));
  await waitFor(contract.connect(signerByAddress[dispute5.jurors[1].toLowerCase()]).voteOnDispute(job5, true));

  await waitFor(contract.connect(actors.freelancerLeo).depositArbiterStake({ value: parseEther("0.09") }));

  const job6 = await createJob(
    actors.clientNova,
    addresses.freelancerZane,
    "Checkout UX Audit",
    "https://demo.escrow/terms/checkout-audit.json",
    "0.48",
    "0.05",
    "0.05",
    5 * 24 * 3600,
    12,
  );
  await waitFor(contract.connect(actors.freelancerZane).acceptJob(job6, { value: parseEther("0.05") }));
  await waitFor(contract.connect(actors.freelancerZane).submitWork(job6, "https://demo.escrow/work/checkout-audit-report"));

  const frontendConfigPath = resolve("frontend/src/config/deployment.json");
  await mkdir(dirname(frontendConfigPath), { recursive: true });
  await writeFile(
    frontendConfigPath,
    JSON.stringify(
      {
        address: await contract.getAddress(),
        chainId: 31337,
        networkName: "Hardhat localhost",
        abi: artifact.abi,
        demoAccounts: [
          { key: "clientAtlas", label: "Atlas Studio", role: "client", address: addresses.clientAtlas },
          { key: "freelancerMaya", label: "Maya Chen", role: "freelancer", address: addresses.freelancerMaya },
          { key: "clientNova", label: "Nova Labs", role: "client", address: addresses.clientNova },
          { key: "freelancerLeo", label: "Leo Ortiz", role: "freelancer", address: addresses.freelancerLeo },
          { key: "bootstrapAva", label: "Ava Review Guild", role: "bootstrap-arbiter", address: addresses.bootstrapAva },
          { key: "bootstrapIris", label: "Iris Review Guild", role: "bootstrap-arbiter", address: addresses.bootstrapIris },
          { key: "bootstrapRhett", label: "Rhett Review Guild", role: "bootstrap-arbiter", address: addresses.bootstrapRhett },
          { key: "clientOrbit", label: "Orbit Commerce", role: "client", address: addresses.clientOrbit },
          { key: "freelancerZane", label: "Zane Parker", role: "freelancer", address: addresses.freelancerZane },
        ],
        seededJobs: [job1, job2, job3, job4, job5, job6],
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("FreelancerEscrow deployed to:", await contract.getAddress());
  console.log("frontend config written to:", frontendConfigPath);
  console.log("Seeded jobs:", job1, job2, job3, job4, job5, job6);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
