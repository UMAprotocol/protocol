// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../../../oracle/interfaces/StoreInterface.sol";
import "../../../oracle/interfaces/OracleInterface.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/interfaces/AdministrateeInterface.sol";
import "../../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../../oracle/interfaces/RegistryInterface.sol";
import "../../../oracle/implementation/Constants.sol";

import "../../perpetual-multiparty/PerpetualInterface.sol";
import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/Lockable.sol";
import "../../../common/implementation/FixedPoint.sol";

/**
 * @notice FundingRateStore always makes available the current funding rate for a given perpetual contract address.
 * "Proposers" can update funding rates by proposing a new rate and waiting for a proposal liveness to expire. During
 * the liveness period, "Disputers" can reject a proposed funding rate and raise a price request against the DVM.
 * Cash flows as follows in the following actions:
 *
 * VARIABLES:
 * - Final fee bond   : a constant value unique for each funding rate identifier and perpetual contract (we assume that
 *                      every perpetual is 1-to-1 mapped to a funding rate identifier).
 * - Proposal bond    : the product of the "proposalBondPct" state variable and a given perpetual's PfC at the time of
 *                      proposal.
 * - Dispute bond     : same as the proposal bond currently.
 * - Proposal reward  : the product of a given perpetual's PfC and its "reward rate" at the time of
 *                      proposal. The reward rate implies that the reward gets larger as time since the last proposal
 *                      increases, and also includes a "difference factor" to give more weight to larger funding rate
 *                      changes.
 *
 * ACTIONS:
 * - Proposing a new funding rate:
 *     - Proposer pays: (final fee bond) + (proposal bond)
 *     - Store receives: (final fee bond) + (proposal bond)
 * - Publishing a proposal after its liveness expires:
 *     - Proposer receives: (final fee bond) + (proposal bond) + (proposal reward)
 *     - Perpetual pays: (proposal reward)
 *     - Store pays: (final fee bond) + (proposal bond)
 * - Disputing a pending proposal:
 *     - Disputer pays: (final fee bond) + (disputer bond)
 *     - Store receives (disputer bond)
 *     - DVM receives (final fee bond)
 * - Settling a dispute after the DVM resolves its price request:
 *     - Winner of dispute (disputer or proposer) receives: (proposal bond) + (disputer bond) + (final fee bond)
 *     - Store pays: (proposal bond) + (disputer bond) + (final fee bond)
 */
contract FundingRateStore is FundingRateStoreInterface, Testable, Lockable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;

    /****************************************
     *        STORE DATA STRUCTURES         *
     ****************************************/

    FixedPoint.Unsigned public proposalBondPct; // Percentage of 1, e.g. 0.0005 is 0.05%

    // Finder contract used to look up addresses for UMA system contracts.
    FinderInterface public finder;

    struct Proposal {
        FixedPoint.Signed rate;
        uint256 time;
        address proposer;
        FixedPoint.Unsigned finalFee;
        FixedPoint.Unsigned proposalBond;
        address disputer;
        FixedPoint.Unsigned rewardRate;
    }

    struct FundingRateRecord {
        FixedPoint.Signed rate; // Current funding rate.
        uint256 proposeTime; // Time at which current funding rate was proposed.
        Proposal proposal;
        FixedPoint.Unsigned rewardRatePerSecond; // Percentage of 1 E.g., .1 is 10%.
    }

    enum ProposalState { None, Pending, Expired }

    mapping(address => FundingRateRecord) private fundingRateRecords;
    // TODO: Is there any reason to make `fundingRateDisputes` public? Could users use the dispute struct
    // to get funding rate data "for free"? If not, then I see no harm in making it public.
    mapping(address => mapping(uint256 => FundingRateRecord)) private fundingRateDisputes;

    uint256 public proposalLiveness;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event ChangedRewardRate(address indexed perpetual, uint256 rewardRate);
    event ProposedRate(
        address indexed perpetual,
        int256 rate,
        uint256 indexed proposalTime,
        address indexed proposer,
        uint256 rewardPct,
        uint256 proposalBond,
        uint256 finalFeeBond
    );
    event DisputedRate(
        address indexed perpetual,
        int256 rate,
        uint256 indexed proposalTime,
        address indexed proposer,
        address disputer,
        uint256 disputeBond,
        uint256 finalFeeBond
    );
    event PublishedRate(
        address indexed perpetual,
        int256 rate,
        uint256 indexed proposalTime,
        address indexed proposer,
        uint256 rewardPct,
        uint256 rewardPayment,
        uint256 totalPayment
    );
    event DisputedRateSettled(
        address indexed perpetual,
        uint256 indexed proposalTime,
        address proposer,
        address indexed disputer,
        bool disputeSucceeded
    );
    event FinalFeesPaid(address indexed collateralCurrency, uint256 indexed amount);
    event WithdrawErrorIgnored(address indexed perpetual, uint256 withdrawAmount);

    /****************************************
     *                MODIFIERS             *
     ****************************************/

    // Pubishes any pending proposals whose liveness has passed, pays out rewards for such proposals.
    modifier publishAndWithdrawProposal(address perpetual) {
        _publishRateAndWithdrawRewards(perpetual);
        _;
    }

    // Function callable only by contracts registered with the DVM.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    constructor(
        uint256 _proposalLiveness,
        address _finderAddress,
        address _timerAddress,
        FixedPoint.Unsigned memory _proposalBondPct
    ) public Testable(_timerAddress) {
        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;
        proposalBondPct = _proposalBondPct;
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Gets the latest funding rate for a perpetual contract.
     * @dev This method should never revert. Moreover, because this method is designed to be called by the `perpetual`
     * contract, it should never make a call back to the `perpetual` contract. Otherwise it will trigger the
     * `perpetual`'s reentrancy guards and cause the external calls to revert.
     * @param perpetual perpetual contract whose funding rate identifier that the calling contracts wants to get
     * a funding rate for.
     * @return FixedPoint.Signed representing the funding rate for the given contract. 0.01 would represent a funding
     * rate of 1% per second. -0.01 would represent a negative funding rate of -1% per second.
     */
    function getFundingRateForContract(address perpetual)
        external
        view
        override
        onlyRegisteredContract()
        nonReentrantView()
        returns (FixedPoint.Signed memory)
    {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.rate;
        } else {
            return fundingRateRecord.rate;
        }
    }

    /**
     * @notice Gets the projected reward % for a successful proposer of a funding rate for a given perpetual contract.
     * @dev This method is designed to be helpful for proposers in projecting their rewards. The reward % is a function
     * of the perpetual contract's base reward % per second, the time elapsed since the last proposal, and the
     * magnitude of change between the proposed and current funding rates. Note that unless the caller calls this
     * method and proposes a funding rate in the same block, then the projected reward will be slightly underestimated.
     * Note also that the actual reward is dependent on the perpetual's `PfC` at publish time and this method's
     * reward %.
     * @param perpetual Perpetual contract whose reward the caller is querying.
     * @param rate Proposed rate.
     * @return rewardRate Representing the reward % for a given contract if they were to propose a funding rate
     * now.
     */
    function getRewardRateForContract(address perpetual, FixedPoint.Signed memory rate)
        external
        view
        nonReentrantView()
        returns (FixedPoint.Unsigned memory rewardRate)
    {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);

        rewardRate = _calculateProposalRewardPct(
            perpetual,
            fundingRateRecord.proposeTime,
            getCurrentTime(),
            rate,
            fundingRateRecord.rate
        );
    }

    /**
     * @notice Propose a new funding rate for a perpetual.
     * @dev This will revert if there is already a pending funding rate for the perpetual.
     * @dev Caller must approve this contract to spend `finalFeeBond` + `proposalBond` amount of collateral, which they can
     * receive back once their funding rate is published.
     * @param perpetual Perpetual contract to propose funding rate for.
     * @param rate Proposed rate.
     */
    function propose(address perpetual, FixedPoint.Signed memory rate)
        external
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
    {
        // Ensure that the perpetual's funding rate identifier is whitelisted with the DVM, otherwise disputes on this
        // proposal would not be possible.
        require(
            _getIdentifierWhitelist().isIdentifierSupported(PerpetualInterface(perpetual).getFundingRateIdentifier()),
            "Unsupported funding identifier"
        );

        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        require(_getProposalState(fundingRateRecord.proposal) != ProposalState.Pending, "Pending proposal exists");
        require(!fundingRateRecord.rate.isEqual(rate), "Cannot propose same rate");
        uint256 currentTime = getCurrentTime();

        // Make sure that there is no disputed proposal for the same perpetual and proposal time. This prevents
        // the proposer from potentially overwriting a proposal. Note that this would be a rare case in which the
        // proposer [ (1) created a proposal, (2) disputed the proposal, and (3) created another proposal ] all within
        // the same block. The proposer would lose their bond from the first proposal forever.
        require(
            _getFundingRateDispute(perpetual, currentTime).proposal.proposer == address(0x0),
            "Proposal pending dispute"
        );

        // Compute final fee at time of proposal.
        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        FixedPoint.Unsigned memory finalFeeBond = _computeFinalFees(collateralCurrency);

        // Calculate and store reward %. Note that because this saved data is a percent, the actual reward
        // will vary at publish time depending on the `perpetual`'s PfC at that time.
        FixedPoint.Unsigned memory rewardRate =
            _calculateProposalRewardPct(
                perpetual,
                fundingRateRecord.proposeTime,
                currentTime,
                rate,
                fundingRateRecord.rate
            );

        // Compute proposal bond.
        FixedPoint.Unsigned memory proposalBond = proposalBondPct.mul(AdministrateeInterface(perpetual).pfc());

        // Enqueue proposal.
        fundingRateRecord.proposal = Proposal({
            rate: rate,
            time: currentTime,
            proposer: msg.sender,
            finalFee: finalFeeBond,
            proposalBond: proposalBond,
            disputer: address(0x0),
            rewardRate: rewardRate
        });
        emit ProposedRate(
            perpetual,
            rate.rawValue,
            currentTime,
            msg.sender,
            rewardRate.rawValue,
            proposalBond.rawValue,
            finalFeeBond.rawValue
        );

        // Pull total bond from proposer.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), proposalBond.add(finalFeeBond).rawValue);
    }

    /**
     * @notice Dispute a pending funding rate. This will delete the pending funding rate, meaning that a
     * proposer can now propose another rate with a fresh liveness.
     * @dev This will revert if there is no pending funding rate for the perpetual.
     * @dev Caller must approve this this contract to spend `finalFeeBond` + `proposalBond` amount of collateral,
     * which they can receive back if their dispute is successful.
     * @param perpetual Contract to dispute proposed funding rate for.
     */
    function dispute(address perpetual) external nonReentrant() publishAndWithdrawProposal(perpetual) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        require(_getProposalState(fundingRateRecord.proposal) == ProposalState.Pending, "No pending proposal");

        // Pull proposal bond from disputer and pay DVM store using final fee portion.
        FixedPoint.Unsigned memory proposalBond = fundingRateRecord.proposal.proposalBond;
        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        collateralCurrency.safeTransferFrom(msg.sender, address(this), proposalBond.rawValue);
        _payFinalFees(collateralCurrency, msg.sender, fundingRateRecord.proposal.finalFee);

        // Send price request
        _requestOraclePrice(PerpetualInterface(perpetual).getFundingRateIdentifier(), fundingRateRecord.proposal.time);

        emit DisputedRate(
            perpetual,
            fundingRateRecord.proposal.rate.rawValue,
            fundingRateRecord.proposal.time,
            fundingRateRecord.proposal.proposer,
            msg.sender,
            proposalBond.rawValue,
            fundingRateRecord.proposal.finalFee.rawValue
        );

        // Delete pending proposal and copy into dispute records.
        fundingRateRecord.proposal.disputer = msg.sender;
        fundingRateDisputes[perpetual][fundingRateRecord.proposal.time] = fundingRateRecord;
        delete fundingRateRecords[perpetual].proposal;
    }

    /**
     * @notice Settle a disputed funding rate. The winner of the dispute, either the disputer or the proposer,
     * will receive a rebate for their bonds plus the losing party's bond. This method will also overwrite the
     * current funding rate with the resolved funding rate returned by the Oracle if there has not been a more
     * recent published rate. Pending funding rates are unaffected by this method.
     * @dev This will revert if there is no price available for the disputed funding rate. This contract
     * will pull money from a PerpetualContract ONLY IF the dispute in question fails.
     * @param perpetual Contract to settle disputed funding rate for.
     * @param proposalTime Proposal time at which the disputed funding rate was proposed.
     */
    function settleDispute(address perpetual, uint256 proposalTime)
        external
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
    {
        FundingRateRecord storage fundingRateDispute = _getFundingRateDispute(perpetual, proposalTime);

        // Get the returned funding rate from the oracle. If this has not yet resolved will revert.
        // If the fundingRateDispute struct has been deleted, then this call will also fail because the proposal
        // time will be 0.
        FixedPoint.Signed memory settlementRate =
            _getOraclePrice(PerpetualInterface(perpetual).getFundingRateIdentifier(), proposalTime);

        // Dispute was successful if settled rate is different from proposed rate.
        bool disputeSucceeded = !settlementRate.isEqual(fundingRateDispute.proposal.rate);
        address proposer =
            disputeSucceeded ? fundingRateDispute.proposal.disputer : fundingRateDispute.proposal.proposer;
        emit DisputedRateSettled(
            perpetual,
            proposalTime,
            fundingRateDispute.proposal.proposer,
            fundingRateDispute.proposal.disputer,
            disputeSucceeded
        );

        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        // TODO: Decide whether loser of dispute should lose entire bond or partial
        if (disputeSucceeded) {
            // If dispute succeeds:
            // - Disputer earns back their bonds: dispute bond + final fee bond
            // - Disputer earns as reward: the proposal bond
            FixedPoint.Unsigned memory disputerRebate =
                fundingRateDispute.proposal.proposalBond.add(fundingRateDispute.proposal.finalFee);
            FixedPoint.Unsigned memory disputerReward = fundingRateDispute.proposal.proposalBond;

            collateralCurrency.safeTransfer(
                fundingRateDispute.proposal.disputer,
                disputerReward.add(disputerRebate).rawValue
            );
        } else {
            // If dispute fails:
            // - Proposer earns back their bonds: proposal bond + final fee bond
            // - Proposer earns as reward: the dispute bond
            FixedPoint.Unsigned memory proposerRebate =
                fundingRateDispute.proposal.proposalBond.add(fundingRateDispute.proposal.finalFee);
            FixedPoint.Unsigned memory proposerReward = fundingRateDispute.proposal.proposalBond;

            collateralCurrency.safeTransfer(
                fundingRateDispute.proposal.proposer,
                proposerReward.add(proposerRebate).rawValue
            );
        }

        // Update current rate to settlement rate if there has not been a published funding rate since the dispute
        // began.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        if (fundingRateRecord.proposeTime <= proposalTime) {
            fundingRateRecord.rate = settlementRate;
            fundingRateRecord.proposeTime = proposalTime;
            // Note: Set rewards to 0 since we published the DVM resolved funding rate and there is no proposer to pay.
            emit PublishedRate(perpetual, settlementRate.rawValue, proposalTime, proposer, 0, 0, 0);
        }

        // Delete dispute
        delete fundingRateDisputes[perpetual][proposalTime];
    }

    /**
     * @notice Publishes any expired pending proposals and pays out proposal rewards if neccessary.
     * @param perpetual Contract to check proposed funding rates for.
     */
    function withdrawProposalRewards(address perpetual) external nonReentrant() publishAndWithdrawProposal(perpetual) {}

    /**
     * @notice Set the reward rate (per second) for a specific `perpetual` contract.
     * @dev Callable only by the Perpetual contract.
     */
    function setRewardRate(address perpetual, FixedPoint.Unsigned memory rewardRate)
        external
        override
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
    {
        require(msg.sender == perpetual, "Caller not perpetual");
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        fundingRateRecord.rewardRatePerSecond = rewardRate;

        // Set last propose time to current time since rewards will start accruing from here on out.
        fundingRateRecord.proposeTime = getCurrentTime();

        emit ChangedRewardRate(perpetual, rewardRate.rawValue);
    }

    /**
     * @notice Helpful method for proposers who want to calculate their potential rewards and useful for testing.
     */
    function calculateProposalRewardPct(
        address perpetual,
        uint256 startTime,
        uint256 endTime,
        FixedPoint.Signed memory proposedRate,
        FixedPoint.Signed memory currentRate
    ) external view returns (FixedPoint.Unsigned memory reward) {
        return _calculateProposalRewardPct(perpetual, startTime, endTime, proposedRate, currentRate);
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    function _publishRateAndWithdrawRewards(address perpetual) internal {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);

        // Check if proposal liveness has expired
        if (_getProposalState(fundingRateRecord.proposal) != ProposalState.Expired) {
            return;
        }

        // Publish rate and proposal time.
        fundingRateRecord.rate = fundingRateRecord.proposal.rate;
        fundingRateRecord.proposeTime = fundingRateRecord.proposal.time;

        // Calculate reward for proposer using saved reward rate and current perpetual PfC.
        FixedPoint.Unsigned memory pfc = AdministrateeInterface(perpetual).pfc();
        FixedPoint.Unsigned memory rewardRate = fundingRateRecord.proposal.rewardRate;
        FixedPoint.Unsigned memory reward = rewardRate.mul(pfc);

        // Pull reward payment from Perpetual, and transfer (payment + final fee bond + proposal bond) to proposer.
        // Note: Proposer always receives rebates for their bonds, but may not receive their proposer reward if the
        // perpetual fails to send fees.
        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        FixedPoint.Unsigned memory amountToPay =
            fundingRateRecord.proposal.finalFee.add(fundingRateRecord.proposal.proposalBond);
        try PerpetualInterface(perpetual).withdrawFundingRateFees(reward) returns (
            FixedPoint.Unsigned memory rewardWithdrawn
        ) {
            // Only transfer rewards if withdrawal from perpetual succeeded.
            amountToPay = amountToPay.add(rewardWithdrawn);
        } catch {
            // If the withdraw fails, then only rebate final fee and emit an alert. Because this method is called
            // by every other external method in the contract, its important that this method does not revert.
            emit WithdrawErrorIgnored(perpetual, reward.rawValue);
            reward = FixedPoint.fromUnscaledUint(0);
        }

        collateralCurrency.safeTransfer(fundingRateRecord.proposal.proposer, amountToPay.rawValue);
        emit PublishedRate(
            perpetual,
            fundingRateRecord.proposal.rate.rawValue,
            fundingRateRecord.proposal.time,
            fundingRateRecord.proposal.proposer,
            rewardRate.rawValue,
            reward.rawValue,
            amountToPay.rawValue
        );

        // Delete proposal now that it has been published.
        delete fundingRateRecords[perpetual].proposal;
    }

    // Requests a price for `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePrice(bytes32 identifier, uint256 requestedTime) internal {
        OracleInterface oracle = _getOracle();
        oracle.requestPrice(identifier, requestedTime);
    }

    // Pays UMA Oracle final fees of `amount` in `collateralCurrency` to the Store contract. Final fee is a flat fee
    // charged for each price request.
    function _payFinalFees(
        IERC20 collateralCurrency,
        address payer,
        FixedPoint.Unsigned memory amount
    ) internal {
        if (amount.isEqual(0)) {
            return;
        }

        collateralCurrency.safeTransferFrom(payer, address(this), amount.rawValue);

        emit FinalFeesPaid(address(collateralCurrency), amount.rawValue);

        StoreInterface store = _getStore();
        collateralCurrency.safeIncreaseAllowance(address(store), amount.rawValue);
        store.payOracleFeesErc20(address(collateralCurrency), amount);
    }

    function _calculateProposalRewardPct(
        address perpetual,
        uint256 startTime,
        uint256 endTime,
        FixedPoint.Signed memory proposedRate,
        FixedPoint.Signed memory currentRate
    ) private view returns (FixedPoint.Unsigned memory reward) {
        uint256 timeDiff = endTime.sub(startTime);

        FixedPoint.Unsigned memory rewardRate = _getFundingRateRecord(perpetual).rewardRatePerSecond;

        // First compute the reward for the time elapsed.
        reward = rewardRate.mul(timeDiff);

        // Next scale the reward based on the absolute difference % between the current and proposed rates.
        // Formula:
        //    - reward = reward * (1 + (proposedRate - currentRate) / currentRate)
        // Or, if currentRate = 0:
        //    - reward = reward * (1 + (proposedRate - currentRate))
        FixedPoint.Signed memory diffPercent =
            (currentRate.isEqual(0) ? currentRate.sub(proposedRate) : currentRate.sub(proposedRate).div(currentRate));
        FixedPoint.Unsigned memory absDiffPercent =
            (
                diffPercent.isLessThan(FixedPoint.fromUnscaledInt(0))
                    ? FixedPoint.fromSigned(diffPercent.mul(FixedPoint.fromUnscaledInt(-1)))
                    : FixedPoint.fromSigned(diffPercent)
            );
        // TODO: Set an arbitrary 200% ceiling on the value of `absDiffPercent` so this factor at most triples the reward:
        // - if (absDiffPercent > 2) then reward = reward * 3
        // - else reward = reward * (1 + absDiffPercent)
        reward = reward.mul(absDiffPercent.isGreaterThan(2) ? FixedPoint.fromUnscaledUint(3) : absDiffPercent.add(1));
    }

    // Returns the pending Proposal struct for a perpetual contract.
    function _getFundingRateRecord(address perpetual) private view returns (FundingRateRecord storage) {
        return fundingRateRecords[perpetual];
    }

    // Returns the disputed Proposal struct for a perpetual and proposal time. This returns empty if the dispute
    // has already been resolved via `settleDispute`.
    function _getFundingRateDispute(address perpetual, uint256 time) private view returns (FundingRateRecord storage) {
        return fundingRateDisputes[perpetual][time];
    }

    // Returns whether a proposal is a pending or expired proposal, or does not exist.
    function _getProposalState(Proposal storage proposal) private view returns (ProposalState) {
        uint256 time = proposal.time;
        if (time == 0) {
            return ProposalState.None;
        } else if (getCurrentTime() < time.add(proposalLiveness)) {
            return ProposalState.Pending;
        } else {
            return ProposalState.Expired;
        }
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.
    function _getOraclePrice(bytes32 identifier, uint256 requestedTime)
        internal
        view
        returns (FixedPoint.Signed memory)
    {
        // Create an instance of the oracle and get the price. If the price is not resolved revert.
        OracleInterface oracle = _getOracle();
        require(oracle.hasPrice(identifier, requestedTime), "Unresolved oracle price");
        int256 oraclePrice = oracle.getPrice(identifier, requestedTime);

        return FixedPoint.Signed(oraclePrice);
    }

    function _computeFinalFees(IERC20 collateralCurrency) internal view returns (FixedPoint.Unsigned memory finalFees) {
        StoreInterface store = _getStore();
        return store.computeFinalFee(address(collateralCurrency));
    }

    function _getOracle() internal view returns (OracleInterface) {
        return OracleInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }
}
