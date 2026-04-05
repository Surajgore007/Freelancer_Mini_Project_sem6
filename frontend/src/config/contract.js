import abi from "./abi.json";
import { LOCAL_DEMO_ACCOUNTS, LOCAL_SEEDED_JOBS } from "./demoData";

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim();
export const CONTRACT_ABI = abi;
export const EXPECTED_CHAIN_ID = parseIntegerEnv(import.meta.env.VITE_CHAIN_ID, 31337);
export const EXPECTED_NETWORK_NAME =
  (import.meta.env.VITE_NETWORK_NAME || "").trim() ||
  (EXPECTED_CHAIN_ID === 31337 ? "Hardhat localhost" : "Configured network");

const defaultDemoAccounts = EXPECTED_CHAIN_ID === 31337 ? LOCAL_DEMO_ACCOUNTS : [];
const defaultSeededJobs = EXPECTED_CHAIN_ID === 31337 ? LOCAL_SEEDED_JOBS : [];

export const DEMO_ACCOUNTS = parseJsonEnv(import.meta.env.VITE_DEMO_ACCOUNTS_JSON, defaultDemoAccounts);
export const SEEDED_JOBS = parseJsonEnv(import.meta.env.VITE_SEEDED_JOBS_JSON, defaultSeededJobs);

export const JOB_STATUS = [
  "Unknown",
  "Awaiting Freelancer Stake",
  "Active",
  "Submitted",
  "In Dispute",
  "Completed",
  "Refunded",
  "Cancelled",
];

export const VOTE_LABELS = {
  0: "No vote",
  1: "Client wins",
  2: "Freelancer wins",
};

export function bnToNumber(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseInt(value.toString(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatEth(value, ethersLib) {
  if (!ethersLib) return "0";
  try {
    return ethersLib.utils.formatEther(value ?? 0);
  } catch {
    return "0";
  }
}

export function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatCountdown(seconds) {
  if (!seconds || seconds <= 0) return "Ready";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function shortenAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getAccountMeta(address) {
  if (!address) return null;
  const lower = address.toLowerCase();
  return DEMO_ACCOUNTS.find((entry) => entry.address.toLowerCase() === lower) || null;
}

export function getDisplayName(address) {
  return getAccountMeta(address)?.label || shortenAddress(address);
}

export function parseContractError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "Transaction rejected in wallet.";
  }

  const customName = error?.errorName || error?.error?.errorName;
  if (customName) {
    const map = {
      ZeroAddress: "Address cannot be zero.",
      EmptyTitle: "Project title is required.",
      EmptyTermsURI: "Terms URI is required.",
      EmptyDeliverableURI: "Deliverable URI is required.",
      EmptyDisputeReason: "Dispute reason URI is required.",
      InvalidAmount: "One of the ETH amounts is invalid.",
      InvalidDeadline: "Delivery deadline must be in the future.",
      InvalidReviewPeriod: "Review period is outside the allowed range.",
      NotOwner: "Only the contract owner can do that.",
      NotJobClient: "Only the client can do that.",
      NotJobFreelancer: "Only the assigned freelancer can do that.",
      NotSelectedJuror: "Only a selected juror can vote on this dispute.",
      NotParty: "Only the client or freelancer can raise this dispute.",
      JobNotFound: "That job does not exist.",
      AlreadyVoted: "This juror already voted.",
      DisputeMissing: "No dispute exists for this job.",
      DisputeAlreadyResolved: "This dispute is already resolved.",
      StakeLocked: "Your arbiter stake is locked by an active jury assignment.",
      TransferFailed: "ETH transfer failed.",
      SameClientAndFreelancer: "Client and freelancer must be different wallets.",
    };

    if (customName === "InvalidJobStatus") {
      const current = JOB_STATUS[error?.errorArgs?.[0] ?? 0] ?? "Unknown";
      const expected = JOB_STATUS[error?.errorArgs?.[1] ?? 0] ?? "Unknown";
      return `Invalid state. Contract is "${current}" but expected "${expected}".`;
    }

    if (customName === "MustMatchRequiredStake") {
      return "The ETH sent with the transaction does not match the required amount.";
    }

    if (customName === "ReviewWindowStillOpen") {
      return `Review window still open for ${formatCountdown(bnToNumber(error?.errorArgs?.[0]))}.`;
    }

    if (customName === "DeliveryDeadlineNotReached") {
      return `Delivery deadline not reached. Time left: ${formatCountdown(bnToNumber(error?.errorArgs?.[0]))}.`;
    }

    if (customName === "InsufficientArbiters") {
      return "At least 3 active arbiters are needed before a dispute can start.";
    }

    if (map[customName]) return map[customName];
  }

  const nestedMessage = error?.data?.message || error?.error?.message;
  if (nestedMessage) return nestedMessage;
  if (error?.message) return error.message;
  return "Transaction failed.";
}
