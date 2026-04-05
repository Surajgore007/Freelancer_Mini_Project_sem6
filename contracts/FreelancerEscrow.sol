// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FreelancerEscrow
 * @notice Multi-job escrow hub with party stakes, auto-release, client timeout protection,
 *         and 3-arbiter majority voting for disputes.
 * @dev Arbiters stake ETH to enter the arbiter pool. Jurors are pseudo-randomly selected
 *      from the active pool using on-chain entropy suitable for demo/local-network usage.
 */
contract FreelancerEscrow is ReentrancyGuard {
    address public immutable owner;

    enum JobStatus {
        NONE,
        CREATED,
        ACTIVE,
        SUBMITTED,
        DISPUTED,
        COMPLETED,
        REFUNDED,
        CANCELLED
    }

    enum VoteChoice {
        NONE,
        CLIENT,
        FREELANCER
    }

    struct Job {
        address client;
        address freelancer;
        uint256 paymentAmount;
        uint256 clientStake;
        uint256 freelancerStake;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 submittedAt;
        uint64 deliveryDeadline;
        uint64 reviewPeriod;
        JobStatus status;
        string title;
        string termsURI;
        string deliverableURI;
        string disputeReasonURI;
    }

    struct Dispute {
        bool exists;
        bool resolved;
        uint64 openedAt;
        uint8 votesForClient;
        uint8 votesForFreelancer;
        VoteChoice winner;
        address[3] jurors;
    }

    struct ArbiterProfile {
        uint256 stake;
        uint32 lockedSelections;
        bool active;
    }

    uint256 public constant MIN_ARBITER_STAKE = 0.05 ether;
    uint256 public constant MIN_PARTY_STAKE = 0.001 ether;
    uint256 public constant MIN_REVIEW_PERIOD = 1 hours;
    uint256 public constant MAX_REVIEW_PERIOD = 14 days;
    uint256 public constant DISPUTE_VOTING_WINDOW = 3 days;

    uint256 public jobCount;

    mapping(uint256 => Job) private jobs;
    mapping(uint256 => Dispute) private disputes;
    mapping(uint256 => mapping(address => VoteChoice)) private disputeVotes;

    mapping(address => ArbiterProfile) public arbiterProfiles;
    mapping(address => uint32) public successfulJobsCount;
    mapping(address => uint32) public successfulJobsAsClient;
    mapping(address => uint32) public successfulJobsAsFreelancer;
    mapping(address => uint32) public disputesParticipated;
    mapping(address => bool) public bootstrapArbiterApproved;
    address[] private arbiterPool;
    mapping(address => uint256) private arbiterPoolIndexPlusOne;

    error ZeroAddress();
    error EmptyTitle();
    error EmptyTermsURI();
    error EmptyDeliverableURI();
    error EmptyDisputeReason();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidReviewPeriod();
    error NotOwner();
    error NotJobClient();
    error NotJobFreelancer();
    error NotSelectedJuror();
    error NotParty();
    error InvalidJobStatus(JobStatus current, JobStatus expected);
    error JobNotFound();
    error InsufficientArbiters(uint256 available, uint256 required);
    error AlreadyVoted();
    error DisputeMissing();
    error DisputeAlreadyResolved();
    error DisputeVotingStillOpen(uint256 secondsRemaining);
    error StakeLocked();
    error TransferFailed();
    error DirectETHNotAccepted();
    error SameClientAndFreelancer();
    error MustMatchRequiredStake(uint256 expected, uint256 received);
    error ReviewWindowStillOpen(uint256 secondsRemaining);
    error DeliveryDeadlineNotReached(uint256 secondsRemaining);

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed freelancer,
        uint256 paymentAmount,
        uint256 clientStake,
        uint256 freelancerStake,
        uint256 deliveryDeadline,
        uint256 reviewPeriod,
        string title,
        string termsURI
    );
    event JobCancelled(uint256 indexed jobId);
    event JobAccepted(uint256 indexed jobId, address indexed freelancer, uint256 freelancerStake);
    event WorkSubmitted(uint256 indexed jobId, address indexed freelancer, string deliverableURI, uint256 submittedAt);
    event JobApproved(uint256 indexed jobId, address indexed client);
    event JobAutoReleased(uint256 indexed jobId, address indexed caller);
    event ClientTimeoutClaimed(uint256 indexed jobId, address indexed client);
    event DisputeRaised(
        uint256 indexed jobId,
        address indexed raisedBy,
        string reasonURI,
        address juror1,
        address juror2,
        address juror3
    );
    event DisputeVoteCast(uint256 indexed jobId, address indexed juror, VoteChoice choice);
    event DisputeResolved(uint256 indexed jobId, VoteChoice winner);
    event DisputeJurorsRedrawn(uint256 indexed jobId, address juror1, address juror2, address juror3);
    event ArbiterStakeDeposited(address indexed arbiter, uint256 amount, uint256 totalStake);
    event ArbiterStakeWithdrawn(address indexed arbiter, uint256 amount, uint256 remainingStake);
    event BootstrapArbiterUpdated(address indexed account, bool approved);

    constructor() {
        owner = msg.sender;
    }

    function createJob(
        address freelancer,
        string calldata title,
        string calldata termsURI,
        uint256 paymentAmount,
        uint256 clientStake,
        uint256 freelancerStake,
        uint64 deliveryDeadline,
        uint64 reviewPeriod
    ) external payable nonReentrant returns (uint256 jobId) {
        if (freelancer == address(0)) revert ZeroAddress();
        if (freelancer == msg.sender) revert SameClientAndFreelancer();
        if (bytes(title).length == 0) revert EmptyTitle();
        if (bytes(termsURI).length == 0) revert EmptyTermsURI();
        if (paymentAmount == 0) revert InvalidAmount();
        if (clientStake < MIN_PARTY_STAKE || freelancerStake < MIN_PARTY_STAKE) revert InvalidAmount();
        if (msg.value != paymentAmount + clientStake) {
            revert MustMatchRequiredStake(paymentAmount + clientStake, msg.value);
        }
        if (deliveryDeadline <= block.timestamp) revert InvalidDeadline();
        if (reviewPeriod < MIN_REVIEW_PERIOD || reviewPeriod > MAX_REVIEW_PERIOD) revert InvalidReviewPeriod();

        jobId = ++jobCount;
        jobs[jobId] = Job({
            client: msg.sender,
            freelancer: freelancer,
            paymentAmount: paymentAmount,
            clientStake: clientStake,
            freelancerStake: freelancerStake,
            createdAt: uint64(block.timestamp),
            acceptedAt: 0,
            submittedAt: 0,
            deliveryDeadline: deliveryDeadline,
            reviewPeriod: reviewPeriod,
            status: JobStatus.CREATED,
            title: title,
            termsURI: termsURI,
            deliverableURI: "",
            disputeReasonURI: ""
        });

        emit JobCreated(
            jobId,
            msg.sender,
            freelancer,
            paymentAmount,
            clientStake,
            freelancerStake,
            deliveryDeadline,
            reviewPeriod,
            title,
            termsURI
        );
    }

    function cancelUnacceptedJob(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotJobClient();
        _requireJobStatus(job, JobStatus.CREATED);

        uint256 clientPayout = job.paymentAmount + job.clientStake;
        job.status = JobStatus.CANCELLED;
        job.paymentAmount = 0;
        job.clientStake = 0;

        _sendValue(job.client, clientPayout);
        emit JobCancelled(jobId);
    }

    function acceptJob(uint256 jobId) external payable nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.freelancer) revert NotJobFreelancer();
        _requireJobStatus(job, JobStatus.CREATED);
        if (msg.value != job.freelancerStake) {
            revert MustMatchRequiredStake(job.freelancerStake, msg.value);
        }

        job.acceptedAt = uint64(block.timestamp);
        job.status = JobStatus.ACTIVE;

        emit JobAccepted(jobId, msg.sender, msg.value);
    }

    function submitWork(uint256 jobId, string calldata deliverableURI) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.freelancer) revert NotJobFreelancer();
        _requireJobStatus(job, JobStatus.ACTIVE);
        if (bytes(deliverableURI).length == 0) revert EmptyDeliverableURI();

        job.deliverableURI = deliverableURI;
        job.submittedAt = uint64(block.timestamp);
        job.status = JobStatus.SUBMITTED;

        emit WorkSubmitted(jobId, msg.sender, deliverableURI, block.timestamp);
    }

    function approveWork(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotJobClient();
        _requireJobStatus(job, JobStatus.SUBMITTED);

        _settleSuccessfulDelivery(jobId, false);
        emit JobApproved(jobId, msg.sender);
    }

    function autoRelease(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        _requireJobStatus(job, JobStatus.SUBMITTED);

        uint256 deadline = uint256(job.submittedAt) + uint256(job.reviewPeriod);
        if (block.timestamp < deadline) {
            revert ReviewWindowStillOpen(deadline - block.timestamp);
        }

        _settleSuccessfulDelivery(jobId, true);
        emit JobAutoReleased(jobId, msg.sender);
    }

    function claimClientTimeout(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotJobClient();
        _requireJobStatus(job, JobStatus.ACTIVE);
        if (block.timestamp < job.deliveryDeadline) {
            revert DeliveryDeadlineNotReached(job.deliveryDeadline - block.timestamp);
        }

        uint256 clientPayout = job.paymentAmount + job.clientStake + job.freelancerStake;
        job.status = JobStatus.REFUNDED;
        job.paymentAmount = 0;
        job.clientStake = 0;
        job.freelancerStake = 0;

        _sendValue(job.client, clientPayout);
        emit ClientTimeoutClaimed(jobId, msg.sender);
    }

    function raiseDispute(uint256 jobId, string calldata reasonURI) external nonReentrant {
        Job storage job = _job(jobId);
        if (msg.sender != job.client && msg.sender != job.freelancer) revert NotParty();
        _requireJobStatus(job, JobStatus.SUBMITTED);
        if (bytes(reasonURI).length == 0) revert EmptyDisputeReason();

        address[3] memory jurors = _drawJurors(job, jobId);

        Dispute storage dispute = disputes[jobId];
        dispute.exists = true;
        dispute.resolved = false;
        dispute.openedAt = uint64(block.timestamp);
        dispute.votesForClient = 0;
        dispute.votesForFreelancer = 0;
        dispute.winner = VoteChoice.NONE;
        dispute.jurors = jurors;

        job.disputeReasonURI = reasonURI;
        job.status = JobStatus.DISPUTED;

        emit DisputeRaised(jobId, msg.sender, reasonURI, jurors[0], jurors[1], jurors[2]);
    }

    function voteOnDispute(uint256 jobId, bool releaseToFreelancer) external nonReentrant {
        Job storage job = _job(jobId);
        _requireJobStatus(job, JobStatus.DISPUTED);

        Dispute storage dispute = disputes[jobId];
        if (!dispute.exists) revert DisputeMissing();
        if (dispute.resolved) revert DisputeAlreadyResolved();
        if (!_isSelectedJuror(dispute.jurors, msg.sender)) revert NotSelectedJuror();
        if (disputeVotes[jobId][msg.sender] != VoteChoice.NONE) revert AlreadyVoted();

        VoteChoice choice = releaseToFreelancer ? VoteChoice.FREELANCER : VoteChoice.CLIENT;
        disputeVotes[jobId][msg.sender] = choice;

        if (choice == VoteChoice.CLIENT) {
            dispute.votesForClient += 1;
        } else {
            dispute.votesForFreelancer += 1;
        }

        emit DisputeVoteCast(jobId, msg.sender, choice);

        if (dispute.votesForClient >= 2 || dispute.votesForFreelancer >= 2) {
            _resolveDispute(jobId, dispute);
        }
    }

    function refreshExpiredDispute(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        _requireJobStatus(job, JobStatus.DISPUTED);

        Dispute storage dispute = disputes[jobId];
        if (!dispute.exists) revert DisputeMissing();
        if (dispute.resolved) revert DisputeAlreadyResolved();

        uint256 deadline = uint256(dispute.openedAt) + DISPUTE_VOTING_WINDOW;
        if (block.timestamp < deadline) {
            revert DisputeVotingStillOpen(deadline - block.timestamp);
        }

        for (uint256 i = 0; i < 3; i++) {
            address oldJuror = dispute.jurors[i];
            if (oldJuror != address(0)) {
                if (arbiterProfiles[oldJuror].lockedSelections != 0) {
                    arbiterProfiles[oldJuror].lockedSelections -= 1;
                }
                delete disputeVotes[jobId][oldJuror];
            }
        }

        dispute.votesForClient = 0;
        dispute.votesForFreelancer = 0;
        dispute.winner = VoteChoice.NONE;
        dispute.openedAt = uint64(block.timestamp);
        dispute.jurors = _drawJurors(job, jobId);

        emit DisputeJurorsRedrawn(jobId, dispute.jurors[0], dispute.jurors[1], dispute.jurors[2]);
    }

    function depositArbiterStake() external payable nonReentrant {
        if (msg.value == 0) revert InvalidAmount();

        ArbiterProfile storage profile = arbiterProfiles[msg.sender];
        profile.stake += msg.value;

        _refreshArbiterStatus(msg.sender);

        emit ArbiterStakeDeposited(msg.sender, msg.value, profile.stake);
    }

    function withdrawArbiterStake(uint256 amount) external nonReentrant {
        ArbiterProfile storage profile = arbiterProfiles[msg.sender];
        if (amount == 0 || amount > profile.stake) revert InvalidAmount();
        if (profile.lockedSelections != 0) revert StakeLocked();

        uint256 remaining = profile.stake - amount;
        if (remaining != 0 && remaining < MIN_ARBITER_STAKE) revert InvalidAmount();

        profile.stake = remaining;
        _refreshArbiterStatus(msg.sender);

        _sendValue(msg.sender, amount);
        emit ArbiterStakeWithdrawn(msg.sender, amount, remaining);
    }

    function setBootstrapArbiter(address account, bool approved) external {
        if (msg.sender != owner) revert NotOwner();
        if (account == address(0)) revert ZeroAddress();

        bootstrapArbiterApproved[account] = approved;
        _refreshArbiterStatus(account);

        emit BootstrapArbiterUpdated(account, approved);
    }

    function getJob(uint256 jobId)
        external
        view
        returns (
            address client,
            address freelancer,
            uint256 paymentAmount,
            uint256 clientStake,
            uint256 freelancerStake,
            uint64 createdAt,
            uint64 acceptedAt,
            uint64 submittedAt,
            uint64 deliveryDeadline,
            uint64 reviewPeriod,
            JobStatus status,
            string memory title,
            string memory termsURI,
            string memory deliverableURI,
            string memory disputeReasonURI
        )
    {
        Job storage job = _job(jobId);
        client = job.client;
        freelancer = job.freelancer;
        paymentAmount = job.paymentAmount;
        clientStake = job.clientStake;
        freelancerStake = job.freelancerStake;
        createdAt = job.createdAt;
        acceptedAt = job.acceptedAt;
        submittedAt = job.submittedAt;
        deliveryDeadline = job.deliveryDeadline;
        reviewPeriod = job.reviewPeriod;
        status = job.status;
        title = job.title;
        termsURI = job.termsURI;
        deliverableURI = job.deliverableURI;
        disputeReasonURI = job.disputeReasonURI;
    }

    function getDispute(uint256 jobId)
        external
        view
        returns (
            bool exists,
            bool resolved,
            uint64 openedAt,
            uint8 votesForClient,
            uint8 votesForFreelancer,
            VoteChoice winner,
            address[3] memory jurors
        )
    {
        if (jobs[jobId].status == JobStatus.NONE) revert JobNotFound();
        Dispute storage dispute = disputes[jobId];
        exists = dispute.exists;
        resolved = dispute.resolved;
        openedAt = dispute.openedAt;
        votesForClient = dispute.votesForClient;
        votesForFreelancer = dispute.votesForFreelancer;
        winner = dispute.winner;
        jurors = dispute.jurors;
    }

    function getDisputeVote(uint256 jobId, address juror) external view returns (VoteChoice) {
        if (jobs[jobId].status == JobStatus.NONE) revert JobNotFound();
        return disputeVotes[jobId][juror];
    }

    function getArbiterPool() external view returns (address[] memory) {
        return arbiterPool;
    }

    function getUserReputation(address account)
        external
        view
        returns (
            uint32 successfulJobs,
            uint32 successfulAsClient,
            uint32 successfulAsFreelancer,
            uint32 disputesCount,
            uint256 arbiterStake,
            uint32 lockedSelections,
            bool bootstrapApproved,
            bool reputationEligible,
            bool activeArbiter
        )
    {
        ArbiterProfile storage profile = arbiterProfiles[account];
        successfulJobs = successfulJobsCount[account];
        successfulAsClient = successfulJobsAsClient[account];
        successfulAsFreelancer = successfulJobsAsFreelancer[account];
        disputesCount = disputesParticipated[account];
        arbiterStake = profile.stake;
        lockedSelections = profile.lockedSelections;
        bootstrapApproved = bootstrapArbiterApproved[account];
        reputationEligible = successfulJobs != 0;
        activeArbiter = profile.active;
    }

    function activeArbiterCount() external view returns (uint256) {
        return arbiterPool.length;
    }

    function timeUntilDeliveryDeadline(uint256 jobId) external view returns (uint256) {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.ACTIVE || block.timestamp >= job.deliveryDeadline) {
            return 0;
        }
        return job.deliveryDeadline - block.timestamp;
    }

    function timeUntilAutoRelease(uint256 jobId) external view returns (uint256) {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.SUBMITTED) return 0;

        uint256 deadline = uint256(job.submittedAt) + uint256(job.reviewPeriod);
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }

    function timeUntilDisputeRefresh(uint256 jobId) external view returns (uint256) {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.DISPUTED) return 0;

        Dispute storage dispute = disputes[jobId];
        if (!dispute.exists || dispute.resolved) return 0;

        uint256 deadline = uint256(dispute.openedAt) + DISPUTE_VOTING_WINDOW;
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }

    function receivePayoutPreview(uint256 jobId)
        external
        view
        returns (uint256 clientGetsIfFreelancerWins, uint256 freelancerGetsIfFreelancerWins, uint256 clientGetsIfClientWins)
    {
        Job storage job = _job(jobId);
        freelancerGetsIfFreelancerWins = job.paymentAmount + job.freelancerStake;
        clientGetsIfFreelancerWins = 0;
        clientGetsIfClientWins = job.paymentAmount + job.clientStake;
    }

    function _settleSuccessfulDelivery(uint256 jobId, bool /* autoReleaseFlag */ ) internal {
        Job storage job = jobs[jobId];

        uint256 freelancerPayout = job.paymentAmount + job.freelancerStake;
        uint256 clientPayout = job.clientStake;

        job.status = JobStatus.COMPLETED;
        job.paymentAmount = 0;
        job.clientStake = 0;
        job.freelancerStake = 0;

        _recordSuccessfulCompletion(job.client, true);
        _recordSuccessfulCompletion(job.freelancer, false);

        _sendValue(job.freelancer, freelancerPayout);
        _sendValue(job.client, clientPayout);
    }

    function _resolveDispute(uint256 jobId, Dispute storage dispute) internal {
        Job storage job = jobs[jobId];
        VoteChoice winner = dispute.votesForFreelancer > dispute.votesForClient
            ? VoteChoice.FREELANCER
            : VoteChoice.CLIENT;

        disputesParticipated[job.client] += 1;
        disputesParticipated[job.freelancer] += 1;

        dispute.resolved = true;
        dispute.winner = winner;

        uint256 jurorRewardPool = winner == VoteChoice.FREELANCER ? job.clientStake : job.freelancerStake;
        uint256 majorityCount;

        for (uint256 i = 0; i < 3; i++) {
            address juror = dispute.jurors[i];
            VoteChoice vote = disputeVotes[jobId][juror];

            if (vote == winner) {
                majorityCount++;
            }

            arbiterProfiles[juror].lockedSelections -= 1;
        }

        uint256 rewardPerJuror = majorityCount == 0 ? 0 : jurorRewardPool / majorityCount;
        uint256 rewardRemainder = majorityCount == 0 ? 0 : jurorRewardPool % majorityCount;

        if (winner == VoteChoice.FREELANCER) {
            uint256 freelancerPayout = job.paymentAmount + job.freelancerStake;

            job.status = JobStatus.COMPLETED;
            job.paymentAmount = 0;
            job.clientStake = 0;
            job.freelancerStake = 0;

            _recordSuccessfulCompletion(job.freelancer, false);

            _sendValue(job.freelancer, freelancerPayout);
        } else {
            uint256 clientPayout = job.paymentAmount + job.clientStake;

            job.status = JobStatus.REFUNDED;
            job.paymentAmount = 0;
            job.clientStake = 0;
            job.freelancerStake = 0;

            _sendValue(job.client, clientPayout);
        }

        if (rewardPerJuror != 0 || rewardRemainder != 0) {
            bool remainderSent;
            for (uint256 i = 0; i < 3; i++) {
                address juror = dispute.jurors[i];
                if (disputeVotes[jobId][juror] == winner) {
                    uint256 payout = rewardPerJuror;
                    if (!remainderSent && rewardRemainder != 0) {
                        payout += rewardRemainder;
                        remainderSent = true;
                    }
                    _sendValue(juror, payout);
                }
            }
        }

        emit DisputeResolved(jobId, winner);
    }

    function _recordSuccessfulCompletion(address account, bool asClient) internal {
        successfulJobsCount[account] += 1;
        if (asClient) {
            successfulJobsAsClient[account] += 1;
        } else {
            successfulJobsAsFreelancer[account] += 1;
        }

        _refreshArbiterStatus(account);
    }

    function _drawJurors(Job storage job, uint256 jobId) internal returns (address[3] memory jurors) {
        uint256 eligibleCount;
        address[] memory eligible = new address[](arbiterPool.length);

        for (uint256 i = 0; i < arbiterPool.length; i++) {
            address arbiter = arbiterPool[i];
            ArbiterProfile storage profile = arbiterProfiles[arbiter];

            if (
                profile.active &&
                profile.stake >= MIN_ARBITER_STAKE &&
                arbiter != job.client &&
                arbiter != job.freelancer
            ) {
                eligible[eligibleCount] = arbiter;
                eligibleCount++;
            }
        }

        if (eligibleCount < 3) revert InsufficientArbiters(eligibleCount, 3);

        uint256 seed = uint256(
            keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, jobId, eligibleCount))
        );

        for (uint256 pick = 0; pick < 3; pick++) {
            uint256 remaining = eligibleCount - pick;
            uint256 index = seed % remaining;
            address selected = eligible[index];
            jurors[pick] = selected;

            eligible[index] = eligible[remaining - 1];
            seed = uint256(keccak256(abi.encodePacked(seed, selected, pick)));

            arbiterProfiles[selected].lockedSelections += 1;
        }
    }

    function _job(uint256 jobId) internal view returns (Job storage job) {
        job = jobs[jobId];
        if (job.status == JobStatus.NONE) revert JobNotFound();
    }

    function _requireJobStatus(Job storage job, JobStatus expected) internal view {
        if (job.status != expected) {
            revert InvalidJobStatus(job.status, expected);
        }
    }

    function _isSelectedJuror(address[3] memory jurors, address juror) internal pure returns (bool) {
        return jurors[0] == juror || jurors[1] == juror || jurors[2] == juror;
    }

    function _refreshArbiterStatus(address account) internal {
        ArbiterProfile storage profile = arbiterProfiles[account];
        bool qualifies = _qualifiesForArbiterPool(account);

        if (qualifies && !profile.active) {
            profile.active = true;
            _addArbiterToPool(account);
        } else if (!qualifies && profile.active) {
            profile.active = false;
            _removeArbiterFromPool(account);
        }
    }

    function _qualifiesForArbiterPool(address account) internal view returns (bool) {
        ArbiterProfile storage profile = arbiterProfiles[account];
        bool hasStake = profile.stake >= MIN_ARBITER_STAKE;
        bool hasReputation = successfulJobsCount[account] > 0;
        return hasStake && (hasReputation || bootstrapArbiterApproved[account]);
    }

    function _addArbiterToPool(address arbiter) internal {
        if (arbiterPoolIndexPlusOne[arbiter] != 0) return;
        arbiterPool.push(arbiter);
        arbiterPoolIndexPlusOne[arbiter] = arbiterPool.length;
    }

    function _removeArbiterFromPool(address arbiter) internal {
        uint256 indexPlusOne = arbiterPoolIndexPlusOne[arbiter];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = arbiterPool.length - 1;

        if (index != lastIndex) {
            address lastArbiter = arbiterPool[lastIndex];
            arbiterPool[index] = lastArbiter;
            arbiterPoolIndexPlusOne[lastArbiter] = index + 1;
        }

        arbiterPool.pop();
        delete arbiterPoolIndexPlusOne[arbiter];
    }

    function _sendValue(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        revert DirectETHNotAccepted();
    }
}
