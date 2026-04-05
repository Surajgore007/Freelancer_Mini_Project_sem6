# Freelancer Escrow DApp

Stake-backed freelancer escrow with:

- Client payment plus client honesty stake
- Freelancer stake before work begins
- Immutable terms URI per job
- Auto-release after review silence
- Client timeout claim if no delivery arrives
- 3-arbiter dispute resolution from a staked arbiter pool
- Majority-vote rewards funded by the losing party's stake

## Core flow

1. Client creates a job and funds `payment + clientStake`.
2. Freelancer accepts by staking `freelancerStake`.
3. Freelancer submits a deliverable URI.
4. Client can approve, raise a dispute, or stay silent.
5. If silent past the review window, anyone can trigger auto-release.
6. If disputed, 3 active arbiters are drawn from the arbiter pool and vote.
7. The losing side's stake is split across the majority jurors.

## Local setup

From the repo root:

```bash
npm install
npm run compile
```

Start a local Hardhat node in one terminal:

```bash
npx hardhat node
```

Deploy the contract and generate the frontend deployment config in another terminal:

```bash
npm run deploy:local
```

Install and run the frontend:

```bash
npm run frontend:install
cd frontend
npm run dev
```

## Important implementation notes

- Arbiters use native ETH stake for eligibility.
- Juror selection uses on-chain pseudo-randomness suitable for demo/local use, not production-grade randomness.
- If jurors fail to vote for 3 days, anyone can redraw the jury.
- The frontend reads `frontend/src/config/deployment.json`, which is auto-written by `scripts/deploy.js`.

## Production caveats

This is still a prototype. Before mainnet use, add:

- formal tests across dispute edge cases
- safer randomness
- reputation / sybil resistance for arbiters
- richer evidence packing and metadata validation
- gas/performance review for large arbiter pools
