# Freelancer Escrow DApp

Stake-backed freelancer escrow with:

- client payment plus client honesty stake
- freelancer stake before work begins
- immutable terms URI per job
- auto-release after review silence
- client timeout claim if no delivery arrives
- 3-arbiter dispute resolution from a staked arbiter pool
- reputation-based arbiter eligibility layered with stake

## Core flow

1. Client creates a job and funds `payment + clientStake`.
2. Freelancer accepts by staking `freelancerStake`.
3. Freelancer submits a deliverable URI.
4. Client can approve, raise a dispute, or stay silent.
5. If silent past the review window, anyone can trigger auto-release.
6. If disputed, 3 active arbiters are drawn from the qualified pool and vote.
7. The losing side's stake is split across the majority jurors.

## Project structure

- `contracts/` smart contracts
- `scripts/deploy.js` local Hardhat deploy + seeded demo setup
- `scripts/deploy-public.js` public testnet deployment helper
- `frontend/` Vite React frontend

## Local demo setup

From the repo root:

```bash
npm install
npm run compile
```

Start a local Hardhat node in one terminal:

```bash
npx hardhat node
```

Deploy the contract and generate frontend local env in another terminal:

```bash
npm run deploy:local
```

Start the frontend:

```bash
npm run frontend:install
cd frontend
npm run dev
```

What `npm run deploy:local` does:

- deploys the contract to your local Hardhat chain
- seeds meaningful demo jobs and arbiter history
- writes `frontend/.env.local` with the local contract address and chain config

If you restart `npx hardhat node`, the chain resets. Run `npm run deploy:local` again.

## Public deployment plan

Recommended setup:

- deploy the smart contract to Sepolia
- deploy the frontend to Vercel

Why this split:

- Vercel is ideal for the Vite frontend
- the blockchain contract must live on a public testnet, not on your local Hardhat node

## Public contract deployment

Create a root `.env` from [.env.example](./.env.example):

```bash
RPC_URL=YOUR_SEPOLIA_RPC_URL
DEPLOYER_PRIVATE_KEY=YOUR_WALLET_PRIVATE_KEY
TARGET_CHAIN_ID=11155111
TARGET_NETWORK_NAME=Sepolia
```

Then run:

```bash
npm install
npm run compile
npm run deploy:public
```

The script will print:

- deployed contract address
- deployer address
- Vercel env vars you should copy into the frontend deployment

Optional:

```bash
$env:WRITE_FRONTEND_ENV="true"
npm run deploy:public
```

That writes `frontend/.env.production.local` for local preview builds.

## Vercel deployment

Push the repo to GitHub, then create a Vercel project using:

- framework preset: `Vite`
- root directory: `frontend`
- build command: `npm run build`
- output directory: `dist`

Set these Vercel environment variables:

- `VITE_CONTRACT_ADDRESS`
- `VITE_CHAIN_ID`
- `VITE_NETWORK_NAME`

For Sepolia:

- `VITE_CHAIN_ID=11155111`
- `VITE_NETWORK_NAME=Sepolia`

You can copy the exact values from the output of `npm run deploy:public`.

## Teacher demo checklist

### Option 1: safest live demo

- deploy contract to Sepolia
- deploy frontend to Vercel
- connect MetaMask on Sepolia
- use Sepolia ETH from a faucet

### Option 2: safest backup demo

- keep the full local Hardhat demo ready as fallback
- if internet or faucet issues happen, use:
  - `npx hardhat node`
  - `npm run deploy:local`
  - `cd frontend && npm run dev`

Best practice is to have both ready.

## Git and secret safety

Do not commit:

- `.env`
- `frontend/.env.local`
- `frontend/.env.production.local`
- private keys
- seed phrases
- generated folders like `node_modules`, `artifacts`, `cache`, `frontend/dist`

If your first commit already tracked generated folders, untrack them once:

```bash
git add .gitignore
git rm -r --cached node_modules artifacts cache frontend/dist
git commit -m "Add gitignore and stop tracking generated files"
```

If a real private key or seed phrase was ever committed, rotate it immediately.

## Production caveats

This is still a prototype. Before real production use, add:

- formal tests across dispute edge cases
- safer randomness for juror selection
- stronger sybil resistance for arbiters
- richer evidence packing and metadata validation
- gas/performance review for larger arbiter pools
