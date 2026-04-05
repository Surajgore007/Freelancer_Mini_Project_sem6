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
