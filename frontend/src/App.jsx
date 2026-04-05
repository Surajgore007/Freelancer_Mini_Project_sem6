import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "./context/Web3Context";
import { useContractData } from "./hooks/useContractData";
import { useTransaction } from "./hooks/useTransaction";
import {
  CONTRACT_ADDRESS,
  EXPECTED_CHAIN_ID,
  getAccountMeta,
  getDisplayName,
  JOB_STATUS,
  SEEDED_JOBS,
  VOTE_LABELS,
  formatCountdown,
  formatDateTime,
  shortenAddress,
} from "./config/contract";

const EMPTY_CREATE_FORM = {
  freelancer: "",
  title: "",
  termsURI: "",
  paymentAmount: "",
  clientStake: "",
  freelancerStake: "",
  deliveryDeadline: "",
  reviewHours: "72",
};

function SectionTitle({ eyebrow, title, description }) {
  return (
    <div className="section-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <p>{hint}</p> : null}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}>{JOB_STATUS[status] || "Unknown"}</span>;
}

function Banner({ tone = "info", children }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}

function PersonLabel({ address }) {
  const meta = getAccountMeta(address);
  return (
    <div className="person-label">
      <strong>{meta?.label || shortenAddress(address)}</strong>
      <span>{shortenAddress(address)}</span>
    </div>
  );
}

function parseRequiredEth(value) {
  if (!value || Number(value) <= 0) {
    throw new Error("Enter a positive ETH amount.");
  }
  return ethers.utils.parseEther(value);
}

function App() {
  const {
    account,
    connectWallet,
    connecting,
    contract,
    deploymentReady,
    disconnectWallet,
    error: walletError,
    expectedNetwork,
    wrongNetwork,
  } = useWeb3();
  const data = useContractData();
  const tx = useTransaction();

  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState("");
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [arbiterStakeAmount, setArbiterStakeAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [submissionInputs, setSubmissionInputs] = useState({});
  const [disputeInputs, setDisputeInputs] = useState({});

  useEffect(() => {
    setActionError("");
  }, [account, wrongNetwork, deploymentReady]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const isBusy = tx.status === "pending" || tx.status === "mining";
  const actionsBlocked =
    !account ||
    wrongNetwork ||
    isBusy ||
    !deploymentReady ||
    !contract ||
    Boolean(data.fetchError);

  const myJobs = useMemo(() => {
    if (!account) return [];
    const lower = account.toLowerCase();
    return data.jobs.filter(
      (job) =>
        job.client.toLowerCase() === lower ||
        job.freelancer.toLowerCase() === lower ||
        job.dispute?.jurors?.some((juror) => juror.toLowerCase() === lower),
    );
  }, [account, data.jobs]);

  const summary = useMemo(() => {
    const disputed = data.jobs.filter((job) => job.status === 4).length;
    const active = data.jobs.filter((job) => job.status === 2 || job.status === 3).length;
    const completed = data.jobs.filter((job) => job.status === 5).length;
    const bootstrapArbiters = data.participants.filter((entry) => entry.bootstrapApproved).length;
    const reputationArbiters = data.participants.filter(
      (entry) => entry.activeArbiter && entry.reputationEligible,
    ).length;
    return { disputed, active, completed, bootstrapArbiters, reputationArbiters };
  }, [data.jobs, data.participants]);

  const orderedJobs = useMemo(() => {
    if (!account) return data.jobs;
    const mine = new Set(myJobs.map((job) => job.id));
    return [...myJobs, ...data.jobs.filter((job) => !mine.has(job.id))];
  }, [account, data.jobs, myJobs]);

  const runTx = async (fn, onSuccess) => {
    await tx.execute(fn, async () => {
      await data.refresh();
      if (onSuccess) onSuccess();
    });
  };

  const assertWriteReady = async () => {
    if (!deploymentReady || !contract) {
      throw new Error("Contract is not ready. Start `npx hardhat node`, run `npm run deploy:local`, then refresh the app.");
    }

    try {
      const code = await contract.provider.getCode(CONTRACT_ADDRESS);
      if (!code || code === "0x") {
        throw new Error("No contract code found at the configured address. Run `npm run deploy:local` again.");
      }
    } catch (error) {
      throw new Error("Cannot reach the local Hardhat chain. Make sure `npx hardhat node` is running and MetaMask is on `Hardhat Local`.");
    }
  };

  const runGuarded = async (work) => {
    setActionError("");
    try {
      await work();
    } catch (error) {
      console.error(error);
      setActionError(error?.message || "Action failed.");
    }
  };

  const createJob = async () => {
    await assertWriteReady();

    const paymentAmount = parseRequiredEth(createForm.paymentAmount);
    const clientStake = parseRequiredEth(createForm.clientStake);
    const freelancerStake = parseRequiredEth(createForm.freelancerStake);
    const deliveryDeadline = Math.floor(new Date(createForm.deliveryDeadline).getTime() / 1000);
    const reviewPeriod = parseInt(createForm.reviewHours, 10) * 3600;

    if (!createForm.freelancer || !ethers.utils.isAddress(createForm.freelancer)) {
      throw new Error("Enter a valid freelancer wallet.");
    }

    if (account && createForm.freelancer.trim().toLowerCase() === account.toLowerCase()) {
      throw new Error("Client and freelancer must be different wallets.");
    }

    if (!createForm.title.trim()) {
      throw new Error("Project title is required.");
    }

    if (!createForm.termsURI.trim()) {
      throw new Error("Add a terms URI or IPFS JSON link.");
    }

    if (!deliveryDeadline || Number.isNaN(deliveryDeadline)) {
      throw new Error("Choose a delivery deadline.");
    }

    const latestBlock = await contract.provider.getBlock("latest");
    const chainTimestamp = Number(latestBlock?.timestamp || 0);

    if (deliveryDeadline <= chainTimestamp) {
      throw new Error(
        `Delivery deadline must be after the blockchain time (${new Date(chainTimestamp * 1000).toLocaleString()}).`,
      );
    }

    if (!Number.isInteger(reviewPeriod) || reviewPeriod < 3600) {
      throw new Error("Review period must be at least 1 hour.");
    }

    await runTx(
      () =>
        contract.createJob(
          createForm.freelancer.trim(),
          createForm.title.trim(),
          createForm.termsURI.trim(),
          paymentAmount,
          clientStake,
          freelancerStake,
          deliveryDeadline,
          reviewPeriod,
          { value: paymentAmount.add(clientStake) },
        ),
      () => setCreateForm(EMPTY_CREATE_FORM),
    );
  };

  const depositArbiterStake = async () => {
    await assertWriteReady();
    const amount = parseRequiredEth(arbiterStakeAmount);
    await runTx(() => contract.depositArbiterStake({ value: amount }), () => setArbiterStakeAmount(""));
  };

  const withdrawArbiterStake = async () => {
    await assertWriteReady();
    const amount = parseRequiredEth(withdrawAmount);
    await runTx(() => contract.withdrawArbiterStake(amount), () => setWithdrawAmount(""));
  };

  const handleJobAction = async (job, action) => {
    await assertWriteReady();

    if (action === "accept") {
      await runTx(() => contract.acceptJob(job.id, { value: job.freelancerStakeRaw }));
      return;
    }

    if (action === "cancel") {
      await runTx(() => contract.cancelUnacceptedJob(job.id));
      return;
    }

    if (action === "approve") {
      await runTx(() => contract.approveWork(job.id));
      return;
    }

    if (action === "autoRelease") {
      await runTx(() => contract.autoRelease(job.id));
      return;
    }

    if (action === "timeout") {
      await runTx(() => contract.claimClientTimeout(job.id));
      return;
    }

    if (action === "submit") {
      const deliverableURI = (submissionInputs[job.id] || "").trim();
      if (!deliverableURI) throw new Error("Add a deliverable URI before submitting.");
      await runTx(
        () => contract.submitWork(job.id, deliverableURI),
        () => setSubmissionInputs((prev) => ({ ...prev, [job.id]: "" })),
      );
      return;
    }

    if (action === "dispute") {
      const reasonURI = (disputeInputs[job.id] || "").trim();
      if (!reasonURI) throw new Error("Add a dispute evidence URI before opening arbitration.");
      await runTx(
        () => contract.raiseDispute(job.id, reasonURI),
        () => setDisputeInputs((prev) => ({ ...prev, [job.id]: "" })),
      );
      return;
    }

    if (action === "refreshDispute") {
      await runTx(() => contract.refreshExpiredDispute(job.id));
    }
  };

  const castVote = async (jobId, releaseToFreelancer) => {
    await assertWriteReady();
    await runTx(() => contract.voteOnDispute(jobId, releaseToFreelancer));
  };

  const renderJobActions = (job) => {
    if (!account) return null;

    const lower = account.toLowerCase();
    const isClient = job.client.toLowerCase() === lower;
    const isFreelancer = job.freelancer.toLowerCase() === lower;
    const isJuror = job.dispute?.jurors?.some((juror) => juror.toLowerCase() === lower);

    const autoReleaseReady =
      job.status === 3 && now >= (job.submittedAt + job.reviewPeriod) * 1000;
    const deliveryExpired =
      job.status === 2 && now >= job.deliveryDeadline * 1000;
    const disputeRefreshReady =
      job.status === 4 &&
      job.dispute &&
      now >= (job.dispute.openedAt + data.disputeVotingWindow) * 1000;

    return (
      <div className="job-actions">
        {isClient && job.status === 1 ? (
          <button className="btn btn-outline" disabled={isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "cancel"))}>
            Cancel job
          </button>
        ) : null}

        {isFreelancer && job.status === 1 ? (
          <button className="btn btn-primary" disabled={isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "accept"))}>
            Stake {job.freelancerStake} ETH and accept
          </button>
        ) : null}

        {isFreelancer && job.status === 2 ? (
          <>
            <Field label="Deliverable URI" hint="Use IPFS, GitHub, Figma, or any immutable work reference.">
              <input
                className="input"
                placeholder="ipfs://... or https://..."
                value={submissionInputs[job.id] || ""}
                onChange={(event) =>
                  setSubmissionInputs((prev) => ({ ...prev, [job.id]: event.target.value }))
                }
              />
            </Field>
            <button className="btn btn-primary" disabled={isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "submit"))}>
              Submit work
            </button>
          </>
        ) : null}

        {isClient && job.status === 2 ? (
          <button className="btn btn-danger" disabled={!deliveryExpired || isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "timeout"))}>
            Claim client timeout
          </button>
        ) : null}

        {job.status === 2 ? (
          <p className="micro-copy">
            Delivery deadline: {formatDateTime(job.deliveryDeadline)}.
            {deliveryExpired ? " Client timeout can now be claimed." : ` ${formatCountdown(Math.max(0, Math.floor((job.deliveryDeadline * 1000 - now) / 1000)))} left.`}
          </p>
        ) : null}

        {job.status === 3 ? (
          <>
            <div className="split-actions">
              {isClient ? (
                <button className="btn btn-success" disabled={isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "approve"))}>
                  Approve and release
                </button>
              ) : null}
              <button className="btn btn-outline" disabled={!autoReleaseReady || isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "autoRelease"))}>
                Trigger auto-release
              </button>
            </div>

            {(isClient || isFreelancer) ? (
              <>
                <Field label="Dispute evidence URI" hint="Point arbiters to the proof pack, checklist, screenshots, or chat log.">
                  <input
                    className="input"
                    placeholder="ipfs://... or https://..."
                    value={disputeInputs[job.id] || ""}
                    onChange={(event) =>
                      setDisputeInputs((prev) => ({ ...prev, [job.id]: event.target.value }))
                    }
                  />
                </Field>
                <button className="btn btn-danger" disabled={isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "dispute"))}>
                  Raise dispute
                </button>
              </>
            ) : null}

            <p className="micro-copy">
              Review window: {formatCountdown(Math.max(0, Math.floor(((job.submittedAt + job.reviewPeriod) * 1000 - now) / 1000)))}.
            </p>
          </>
        ) : null}

        {job.status === 4 && isJuror && job.dispute?.myVote === 0 ? (
          <div className="split-actions">
            <button className="btn btn-outline" disabled={isBusy} onClick={() => void runGuarded(() => castVote(job.id, false))}>
              Vote client
            </button>
            <button className="btn btn-success" disabled={isBusy} onClick={() => void runGuarded(() => castVote(job.id, true))}>
              Vote freelancer
            </button>
          </div>
        ) : null}

        {job.status === 4 && isJuror && job.dispute?.myVote !== 0 ? (
          <Banner tone="info">Your vote: {VOTE_LABELS[job.dispute.myVote]}</Banner>
        ) : null}

        {job.status === 4 ? (
          <>
            <p className="micro-copy">
              If jurors stop responding, anyone can redraw the panel after {formatCountdown(Math.max(0, Math.floor((((job.dispute?.openedAt || 0) + data.disputeVotingWindow) * 1000 - now) / 1000)))}.
            </p>
            <button className="btn btn-outline" disabled={!disputeRefreshReady || isBusy} onClick={() => void runGuarded(() => handleJobAction(job, "refreshDispute"))}>
              Redraw expired jury
            </button>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Freelancer Escrow</p>
          <h1>Stake-backed work approval without a trusted platform middleman.</h1>
        </div>

        <div className="wallet-panel">
          {account ? <span className="wallet-chip">{getDisplayName(account)}</span> : null}
          {account ? (
            <button className="btn btn-outline" onClick={disconnectWallet}>
              Disconnect
            </button>
          ) : (
            <button className="btn btn-primary" disabled={connecting} onClick={connectWallet}>
              {connecting ? "Connecting..." : "Connect wallet"}
            </button>
          )}
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Mechanism</span>
          <h2>The contract stays dumb. The incentives do the judging.</h2>
          <p>
            Each job locks the client&apos;s payment plus a client honesty stake. The freelancer
            locks their own stake before starting. If work is accepted or the client goes silent,
            the freelancer gets paid and both honest parties recover their stakes. If there&apos;s a
            dispute, 3 staked arbiters are drawn and the losing side&apos;s stake is paid to the
            majority jurors.
          </p>
        </div>

        <div className="hero-grid">
          <StatCard label="Jobs created" value={data.jobCount} hint="Marketplace-level, not one hardcoded escrow." />
          <StatCard label="Live jobs" value={summary.active} hint="Active or under review." />
          <StatCard label="In dispute" value={summary.disputed} hint="Waiting on juror votes." />
          <StatCard label="Active arbiters" value={data.activeArbiterCount} hint={`${summary.reputationArbiters} earned it, ${summary.bootstrapArbiters} are day-one bootstrap.`} />
        </div>
      </section>

      {walletError ? <Banner tone="danger">{walletError}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {!deploymentReady ? (
        <Banner tone="warning">
          Frontend deployment config is empty. Compile and deploy the contract, then run `node scripts/deploy.js`
          so `frontend/src/config/deployment.json` gets filled.
        </Banner>
      ) : null}
      {account && wrongNetwork ? (
        <Banner tone="warning">Wrong network. Switch to {expectedNetwork} (chain ID {EXPECTED_CHAIN_ID}).</Banner>
      ) : null}
      {deploymentReady ? (
        <Banner tone="info">
          Connected contract: <code>{CONTRACT_ADDRESS}</code>
        </Banner>
      ) : null}

      <section className="content-grid">
        <div className="panel">
          <SectionTitle
            eyebrow="Create a Job"
            title="Lock the payment, stakes, and proof standard up front."
            description="The terms URI should point to immutable job JSON or an IPFS document that contains the scope, checklist, acceptance criteria, and evidence rules."
          />

          <div className="form-grid">
            <Field label="Freelancer wallet">
              <input
                className="input"
                placeholder="0x..."
                value={createForm.freelancer}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, freelancer: event.target.value }))}
              />
            </Field>

            <Field label="Project title">
              <input
                className="input"
                placeholder="Landing page redesign"
                value={createForm.title}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </Field>

            <Field label="Terms URI">
              <input
                className="input"
                placeholder="ipfs://... or https://..."
                value={createForm.termsURI}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, termsURI: event.target.value }))}
              />
            </Field>

            <Field label="Payment (ETH)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={createForm.paymentAmount}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, paymentAmount: event.target.value }))}
              />
            </Field>

            <Field label="Client honesty stake (ETH)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={createForm.clientStake}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, clientStake: event.target.value }))}
              />
            </Field>

            <Field label="Freelancer stake (ETH)">
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={createForm.freelancerStake}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, freelancerStake: event.target.value }))}
              />
            </Field>

            <Field label="Delivery deadline">
              <input
                className="input"
                type="datetime-local"
                value={createForm.deliveryDeadline}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, deliveryDeadline: event.target.value }))}
              />
            </Field>

            <Field label="Review period (hours)" hint="How long the client can stay silent before auto-release unlocks.">
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                value={createForm.reviewHours}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, reviewHours: event.target.value }))}
              />
            </Field>
          </div>

          <button className="btn btn-primary" disabled={actionsBlocked} onClick={() => void runGuarded(createJob)}>
            Create and fund job
          </button>
        </div>

        <div className="panel">
          <SectionTitle
            eyebrow="Arbiter Pool"
            title="Stake ETH to become eligible for dispute selection."
            description="Eligibility now has two layers: at least one successful completed job creates reputation eligibility, and stake turns that reputation into arbiter eligibility. A small bootstrap trust group still exists for day-one coverage."
          />

          <div className="arbiter-metrics">
            <StatCard label="Your arbiter stake" value={`${data.arbiterProfile.stake} ETH`} hint={data.arbiterProfile.active ? "Active in pool" : `Need at least ${data.minArbiterStake} ETH`} />
            <StatCard label="Locked assignments" value={data.arbiterProfile.lockedSelections} hint="Selected juries still open." />
          </div>

          {data.currentUserReputation ? (
            <div className="eligibility-card">
              <p>
                <strong>Successful jobs:</strong> {data.currentUserReputation.successfulJobs}
              </p>
              <p>
                <strong>Bootstrap approved:</strong> {data.currentUserReputation.bootstrapApproved ? "Yes" : "No"}
              </p>
              <p>
                <strong>Reputation eligible:</strong> {data.currentUserReputation.reputationEligible ? "Yes" : "No"}
              </p>
              <p>
                <strong>Currently active arbiter:</strong> {data.currentUserReputation.activeArbiter ? "Yes" : "No"}
              </p>
            </div>
          ) : null}

          <div className="split-fields">
            <Field label="Add arbiter stake">
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={arbiterStakeAmount}
                onChange={(event) => setArbiterStakeAmount(event.target.value)}
              />
            </Field>
            <Field label="Withdraw stake">
              <input
                className="input"
                type="number"
                min="0"
                step="0.001"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
              />
            </Field>
          </div>

          <div className="split-actions">
            <button className="btn btn-primary" disabled={actionsBlocked} onClick={() => void runGuarded(depositArbiterStake)}>
              Add stake
            </button>
            <button className="btn btn-outline" disabled={actionsBlocked} onClick={() => void runGuarded(withdrawArbiterStake)}>
              Withdraw
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <SectionTitle
          eyebrow="Reputation Board"
          title="Operational peer data with stake-backed arbiter eligibility."
          description={`Seeded local network includes ${SEEDED_JOBS.length} jobs so the system starts with meaningful history instead of empty placeholder text.`}
        />

        <div className="reputation-grid">
          {data.participants.map((entry) => {
            const meta = getAccountMeta(entry.address);
            const badge = entry.activeArbiter
              ? entry.bootstrapApproved && !entry.reputationEligible
                ? "Bootstrap arbiter"
                : "Active arbiter"
              : entry.reputationEligible
                ? "Reputation-qualified"
                : "Not yet eligible";

            return (
              <article key={entry.address} className="reputation-card">
                <div className="job-header">
                  <div>
                    <p className="eyebrow">{meta?.role || "participant"}</p>
                    <h3>{getDisplayName(entry.address)}</h3>
                  </div>
                  <span className={`status-pill ${entry.activeArbiter ? "status-5" : "status-2"}`}>{badge}</span>
                </div>

                <div className="job-meta-grid compact">
                  <div>
                    <span>Successful jobs</span>
                    <strong>{entry.successfulJobs}</strong>
                  </div>
                  <div>
                    <span>As client</span>
                    <strong>{entry.successfulAsClient}</strong>
                  </div>
                  <div>
                    <span>As freelancer</span>
                    <strong>{entry.successfulAsFreelancer}</strong>
                  </div>
                  <div>
                    <span>Disputes seen</span>
                    <strong>{entry.disputesCount}</strong>
                  </div>
                  <div>
                    <span>Arbiter stake</span>
                    <strong>{entry.arbiterStake} ETH</strong>
                  </div>
                  <div>
                    <span>Queue locks</span>
                    <strong>{entry.lockedSelections}</strong>
                  </div>
                </div>

                <p className="micro-copy">
                  {entry.bootstrapApproved ? "Bootstrap trusted for day one. " : ""}
                  {entry.reputationEligible
                    ? "Earned platform reputation through at least one successful completed job."
                    : "Needs a successful completed job before stake alone can unlock arbiter duty."}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <SectionTitle
          eyebrow="Jobs"
          title="Every escrow carries its own terms, stakes, delivery deadline, and dispute path."
          description={account ? `Showing ${myJobs.length} jobs relevant to your connected wallet first.` : "Connect a wallet to reveal your role-specific actions."}
        />

        {data.fetchError ? <Banner tone="danger">{data.fetchError}</Banner> : null}
        {tx.status !== "idle" ? (
          <Banner tone={tx.status === "error" ? "danger" : tx.status === "success" ? "success" : "info"}>
            {tx.status === "pending" ? "Waiting for wallet confirmation..." : null}
            {tx.status === "mining" ? "Transaction submitted. Waiting for confirmation..." : null}
            {tx.status === "success" ? "Transaction confirmed." : null}
            {tx.status === "error" ? tx.error : null}
            {tx.txHash ? ` TX: ${tx.txHash}` : null}
          </Banner>
        ) : null}

        {data.loading ? (
          <div className="empty-state">Loading jobs...</div>
        ) : orderedJobs.length === 0 ? (
          <div className="empty-state">No jobs yet. Create the first stake-backed escrow above.</div>
        ) : (
          <div className="job-list">
            {orderedJobs.map((job) => (
              <article key={job.id} className="job-card">
                <div className="job-header">
                  <div>
                    <p className="eyebrow">Job #{job.id}</p>
                    <h3>{job.title}</h3>
                  </div>
                  <StatusPill status={job.status} />
                </div>

                <div className="job-meta-grid">
                  <div>
                    <span>Client</span>
                    <PersonLabel address={job.client} />
                  </div>
                  <div>
                    <span>Freelancer</span>
                    <PersonLabel address={job.freelancer} />
                  </div>
                  <div>
                    <span>Payment</span>
                    <strong>{job.paymentAmount} ETH</strong>
                  </div>
                  <div>
                    <span>Client stake</span>
                    <strong>{job.clientStake} ETH</strong>
                  </div>
                  <div>
                    <span>Freelancer stake</span>
                    <strong>{job.freelancerStake} ETH</strong>
                  </div>
                  <div>
                    <span>Review period</span>
                    <strong>{formatCountdown(job.reviewPeriod)}</strong>
                  </div>
                </div>

                <div className="link-stack">
                  <a href={job.termsURI} target="_blank" rel="noreferrer">
                    Terms pack
                  </a>
                  {job.deliverableURI ? (
                    <a href={job.deliverableURI} target="_blank" rel="noreferrer">
                      Latest deliverable
                    </a>
                  ) : null}
                  {job.disputeReasonURI ? (
                    <a href={job.disputeReasonURI} target="_blank" rel="noreferrer">
                      Dispute evidence
                    </a>
                  ) : null}
                </div>

                {job.dispute ? (
                  <div className="dispute-box">
                    <div className="job-meta-grid compact">
                      <div>
                        <span>Votes for client</span>
                        <strong>{job.dispute.votesForClient}</strong>
                      </div>
                      <div>
                        <span>Votes for freelancer</span>
                        <strong>{job.dispute.votesForFreelancer}</strong>
                      </div>
                      <div>
                        <span>Winner</span>
                        <strong>{VOTE_LABELS[job.dispute.winner]}</strong>
                      </div>
                    </div>

                    <p className="micro-copy">
                      Jurors: {job.dispute.jurors.map((juror) => getDisplayName(juror)).join(", ")}
                    </p>
                  </div>
                ) : null}

                {renderJobActions(job)}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
