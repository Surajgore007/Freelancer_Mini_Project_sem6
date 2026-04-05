import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import { bnToNumber, DEMO_ACCOUNTS, formatEth } from "../config/contract";

export function useContractData() {
  const { account, contract } = useWeb3();
  const [state, setState] = useState({
    loading: true,
    fetchError: null,
    lastUpdated: null,
    jobCount: 0,
    jobs: [],
    activeArbiterCount: 0,
    disputeVotingWindow: 0,
    minArbiterStake: "0",
    participants: [],
    currentUserReputation: null,
    arbiterProfile: {
      stake: "0",
      lockedSelections: 0,
      active: false,
    },
  });

  const refresh = useCallback(async () => {
    if (!contract) {
      setState((prev) => ({
        ...prev,
        loading: false,
        fetchError: null,
        jobs: [],
        jobCount: 0,
        participants: [],
        currentUserReputation: null,
      }));
      return;
    }

    try {
      const [jobCountBn, activeArbiterCountBn, arbiterProfileRaw, disputeVotingWindowBn, minArbiterStakeBn, arbiterPoolRaw] = await Promise.all([
        contract.jobCount(),
        contract.activeArbiterCount(),
        account ? contract.arbiterProfiles(account) : Promise.resolve([ethers.constants.Zero, 0, false]),
        contract.DISPUTE_VOTING_WINDOW(),
        contract.MIN_ARBITER_STAKE(),
        contract.getArbiterPool(),
      ]);

      const totalJobs = bnToNumber(jobCountBn);
      const jobs = await Promise.all(
        Array.from({ length: totalJobs }, async (_, index) => {
          const jobId = index + 1;
          const jobRaw = await contract.getJob(jobId);

          const job = {
            id: jobId,
            client: jobRaw.client,
            freelancer: jobRaw.freelancer,
            paymentAmountRaw: jobRaw.paymentAmount,
            paymentAmount: formatEth(jobRaw.paymentAmount, ethers),
            clientStakeRaw: jobRaw.clientStake,
            clientStake: formatEth(jobRaw.clientStake, ethers),
            freelancerStakeRaw: jobRaw.freelancerStake,
            freelancerStake: formatEth(jobRaw.freelancerStake, ethers),
            createdAt: bnToNumber(jobRaw.createdAt),
            acceptedAt: bnToNumber(jobRaw.acceptedAt),
            submittedAt: bnToNumber(jobRaw.submittedAt),
            deliveryDeadline: bnToNumber(jobRaw.deliveryDeadline),
            reviewPeriod: bnToNumber(jobRaw.reviewPeriod),
            status: bnToNumber(jobRaw.status),
            title: jobRaw.title,
            termsURI: jobRaw.termsURI,
            deliverableURI: jobRaw.deliverableURI,
            disputeReasonURI: jobRaw.disputeReasonURI,
          };

          if (job.status === 4 || job.disputeReasonURI) {
            const disputeRaw = await contract.getDispute(jobId);
            const myVote = account ? await contract.getDisputeVote(jobId, account) : 0;

            job.dispute = {
              exists: disputeRaw.exists,
              resolved: disputeRaw.resolved,
              openedAt: bnToNumber(disputeRaw.openedAt),
              votesForClient: bnToNumber(disputeRaw.votesForClient),
              votesForFreelancer: bnToNumber(disputeRaw.votesForFreelancer),
              winner: bnToNumber(disputeRaw.winner),
              jurors: disputeRaw.jurors,
              myVote: bnToNumber(myVote),
            };
          } else {
            job.dispute = null;
          }

          return job;
        }),
      );

      jobs.sort((a, b) => b.id - a.id);

      const participantAddresses = new Set(
        DEMO_ACCOUNTS.map((entry) => entry.address.toLowerCase()),
      );

      arbiterPoolRaw.forEach((address) => participantAddresses.add(address.toLowerCase()));
      jobs.forEach((job) => {
        participantAddresses.add(job.client.toLowerCase());
        participantAddresses.add(job.freelancer.toLowerCase());
        job.dispute?.jurors?.forEach((juror) => participantAddresses.add(juror.toLowerCase()));
      });
      if (account) participantAddresses.add(account.toLowerCase());

      const participantList = await Promise.all(
        [...participantAddresses].map(async (address) => {
          const reputationRaw = await contract.getUserReputation(address);
          return {
            address,
            successfulJobs: bnToNumber(reputationRaw.successfulJobs ?? reputationRaw[0]),
            successfulAsClient: bnToNumber(reputationRaw.successfulAsClient ?? reputationRaw[1]),
            successfulAsFreelancer: bnToNumber(reputationRaw.successfulAsFreelancer ?? reputationRaw[2]),
            disputesCount: bnToNumber(reputationRaw.disputesCount ?? reputationRaw[3]),
            arbiterStake: formatEth(reputationRaw.arbiterStake ?? reputationRaw[4], ethers),
            lockedSelections: bnToNumber(reputationRaw.lockedSelections ?? reputationRaw[5]),
            bootstrapApproved: Boolean(reputationRaw.bootstrapApproved ?? reputationRaw[6]),
            reputationEligible: Boolean(reputationRaw.reputationEligible ?? reputationRaw[7]),
            activeArbiter: Boolean(reputationRaw.activeArbiter ?? reputationRaw[8]),
          };
        }),
      );

      participantList.sort((left, right) => {
        if (left.activeArbiter !== right.activeArbiter) return left.activeArbiter ? -1 : 1;
        if (left.successfulJobs !== right.successfulJobs) return right.successfulJobs - left.successfulJobs;
        return left.address.localeCompare(right.address);
      });

      const currentUserReputation =
        account ? participantList.find((entry) => entry.address === account.toLowerCase()) || null : null;

      setState({
        loading: false,
        fetchError: null,
        lastUpdated: Date.now(),
        jobCount: totalJobs,
        jobs,
        activeArbiterCount: bnToNumber(activeArbiterCountBn),
        disputeVotingWindow: bnToNumber(disputeVotingWindowBn),
        minArbiterStake: formatEth(minArbiterStakeBn, ethers),
        participants: participantList,
        currentUserReputation,
        arbiterProfile: {
          stake: formatEth(arbiterProfileRaw.stake ?? arbiterProfileRaw[0], ethers),
          lockedSelections: bnToNumber(arbiterProfileRaw.lockedSelections ?? arbiterProfileRaw[1]),
          active: Boolean(arbiterProfileRaw.active ?? arbiterProfileRaw[2]),
        },
      });
    } catch (error) {
      console.error("Failed to fetch contract data:", error);
      setState((prev) => ({
        ...prev,
        loading: false,
        fetchError: "Could not load contract data. Check deployment, wallet network, and ABI sync.",
        lastUpdated: Date.now(),
      }));
    }
  }, [account, contract]);

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!contract) return undefined;

    const events = [
      "JobCreated",
      "JobCancelled",
      "JobAccepted",
      "WorkSubmitted",
      "JobApproved",
      "JobAutoReleased",
      "ClientTimeoutClaimed",
      "DisputeRaised",
      "DisputeVoteCast",
      "DisputeResolved",
      "ArbiterStakeDeposited",
      "ArbiterStakeWithdrawn",
      "BootstrapArbiterUpdated",
    ];

    const listeners = events.map((eventName) => {
      const handler = () => setTimeout(refresh, 500);
      contract.on(eventName, handler);
      return { eventName, handler };
    });

    const interval = setInterval(refresh, 12000);

    return () => {
      clearInterval(interval);
      listeners.forEach(({ eventName, handler }) => contract.off(eventName, handler));
    };
  }, [contract, refresh]);

  return { ...state, refresh };
}
