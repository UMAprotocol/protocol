pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../../../oracle/interfaces/StoreInterface.sol";
import "../../../oracle/interfaces/OracleInterface.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";

import "../../perpetual-multiparty/PerpetualInterface.sol";
import "../../common/FinancialContractInterface.sol";
import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/Lockable.sol";
import "../../../common/implementation/FixedPoint.sol";

contract FundingRateStore is FundingRateStoreInterface, Testable, Lockable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;

    /****************************************
     *        STORE DATA STRUCTURES         *
     ****************************************/

    // Finder contract used to look up addresses for UMA system contracts.
    FinderInterface public finder;

    struct Proposal {
        FixedPoint.Signed rate;
        uint256 time;
        address proposer;
        FixedPoint.Unsigned finalFee;
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

    mapping(address => FundingRateRecord) public fundingRateRecords;
    mapping(address => mapping(uint256 => FundingRateRecord)) public fundingRateDisputes;

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
        uint256 rewardPct
    );
    event DisputedRate(
        address indexed perpetual,
        int256 rate,
        uint256 indexed proposalTime,
        address indexed proposer,
        address disputer
    );
    event PublishedRate(
        address indexed perpetual,
        int256 rate,
        uint256 indexed proposalTime,
        address indexed proposer,
        uint256 rewardPct,
        uint256 reward
    );
    event DisputedRateSettled(
        address indexed perpetual,
        uint256 indexed proposalTime,
        address proposer,
        address indexed disputer,
        bool disputeSucceeded
    );
    event FinalFeesPaid(address indexed collateralCurrency, uint256 indexed amount);

    /****************************************
     *                MODIFIERS             *
     ****************************************/

    // Pubishes any pending proposals whose liveness has passed, pays out rewards for such proposals
    modifier publishAndWithdrawProposal(address perpetual) {
        _publishRateAndWithdrawRewards(perpetual);
        _;
    }

    constructor(
        uint256 _proposalLiveness,
        address _finderAddress,
        address _timerAddress
    ) public Testable(_timerAddress) {
        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Gets the latest funding rate for a perpetual contract.
     * @dev This method should never revert.
     * @param perpetual perpetual contract whose funding rate identifier that the calling contracts wants to get
     * a funding rate for.
     * @return FixedPoint.Signed representing the funding rate for the given contract. 0.01 would represent a funding
     * rate of 1% per second. -0.01 would represent a negative funding rate of -1% per second.
     */
    function getFundingRateForContract(address perpetual)
        external
        override
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
        returns (FixedPoint.Signed memory)
    {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        return fundingRateRecord.rate;
    }

    /**
     * @notice Returns the timestamp at which the current funding rate was proposed.
     * @param perpetual Perpetual to retrieve propose time for.
     * @return propose timestamp.
     */
    function getProposeTimeForContract(address perpetual)
        external
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
        returns (uint256)
    {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        return fundingRateRecord.proposeTime;
    }

    /**
     * @notice Propose a new funding rate for a perpetual.
     * @dev This will revert if there is already a pending funding rate for the perpetual.
     * @dev Caller must approve this contract to spend `finalFeeBond` amount of collateral, which they can
     * receive back once their funding rate is published.
     * @param perpetual Perpetual contract to propose funding rate for.
     * @param rate Proposed rate.
     */
    function propose(address perpetual, FixedPoint.Signed memory rate)
        external
        nonReentrant()
        publishAndWithdrawProposal(perpetual)
    {
        // TODO: check the identifier whitelist to ensure the proposed perpetual's identifier is approved by the DVM.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        require(_getProposalState(fundingRateRecord.proposal) != ProposalState.Pending, "Pending proposal exists");
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
        FixedPoint.Unsigned memory rewardRate = _calculateProposalRewardPct(
            perpetual,
            fundingRateRecord.proposeTime,
            currentTime,
            rate,
            fundingRateRecord.rate
        );

        // TODO: Compute and pull Proposal bond.

        // Enqueue proposal.
        fundingRateRecord.proposal = Proposal({
            rate: rate,
            time: currentTime,
            proposer: msg.sender,
            finalFee: finalFeeBond,
            disputer: address(0x0),
            rewardRate: rewardRate
        });
        emit ProposedRate(perpetual, rate.rawValue, currentTime, msg.sender, rewardRate.rawValue);

        // Pull final fee bond from proposer.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), finalFeeBond.rawValue);
    }

    /**
     * @notice Dispute a pending funding rate. This will delete the pending funding rate, meaning that a
     * proposer can now propose another rate with a fresh liveness.
     * @dev This will revert if there is no pending funding rate for the perpetual.
     * @dev Caller must approve this this contract to spend `finalFeeBond` amount of collateral, which they can
     * receive back if their dispute is successful.
     * @param perpetual Contract to dispute proposed funding rate for.
     */
    function dispute(address perpetual) external nonReentrant() publishAndWithdrawProposal(perpetual) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        require(_getProposalState(fundingRateRecord.proposal) == ProposalState.Pending, "No pending proposal");

        // Pull final fee bond from disputer and pay DVM store.
        _payFinalFees(
            IERC20(PerpetualInterface(perpetual).getCollateralCurrency()),
            msg.sender,
            fundingRateRecord.proposal.finalFee
        );

        // Send price request
        _requestOraclePrice(PerpetualInterface(perpetual).getFundingRateIdentifier(), fundingRateRecord.proposal.time);

        emit DisputedRate(
            perpetual,
            fundingRateRecord.proposal.rate.rawValue,
            fundingRateRecord.proposal.time,
            fundingRateRecord.proposal.proposer,
            msg.sender
        );

        // Delete pending proposal and copy into dispute records.
        fundingRateRecord.proposal.disputer = msg.sender;
        fundingRateDisputes[perpetual][fundingRateRecord.proposal.time] = fundingRateRecord;
        delete fundingRateRecords[perpetual].proposal;
    }

    /**
     * @notice Settle a disputed funding rate. The winner of the dispute, either the disputer or the proposer,
     * will receive a reward (proposer's bond and proposer's reward, respectively) plus their bonds.
     * This method will also overwrite the current funding rate with the resolved funding rate returned by the Oracle
     * if there has not been a more recent published rate. Pending funding rates are unaffected by this method.
     * @dev This will revert if there is no price available for the disputed funding rate.
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
        FixedPoint.Signed memory settlementRate = _getOraclePrice(
            PerpetualInterface(perpetual).getFundingRateIdentifier(),
            proposalTime
        );

        // Dispute was successful if settled rate is different from proposed rate.
        bool disputeSucceeded = !settlementRate.isEqual(fundingRateDispute.proposal.rate);
        address proposer = disputeSucceeded
            ? fundingRateDispute.proposal.disputer
            : fundingRateDispute.proposal.proposer;
        emit DisputedRateSettled(
            perpetual,
            proposalTime,
            fundingRateDispute.proposal.proposer,
            fundingRateDispute.proposal.disputer,
            disputeSucceeded
        );

        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        if (disputeSucceeded) {
            // If dispute succeeds:
            // - pay disputer the proposal bond + final fee rebate

            collateralCurrency.safeTransfer(
                fundingRateDispute.proposal.disputer,
                fundingRateDispute.proposal.finalFee.rawValue
            );
        } else {
            // If dispute fails:
            // - pay proposer the proposal bond + proposal reward + final fee rebate

            FixedPoint.Unsigned memory pfc = FinancialContractInterface(perpetual).pfc();
            FixedPoint.Unsigned memory rewardRate = fundingRateDispute.proposal.rewardRate;
            FixedPoint.Unsigned memory reward = rewardRate.mul(pfc);

            FixedPoint.Unsigned memory payToProposer = fundingRateDispute.proposal.finalFee.add(reward);
            PerpetualInterface(perpetual).withdrawFundingRateFees(reward);
            collateralCurrency.safeTransfer(fundingRateDispute.proposal.proposer, payToProposer.rawValue);
        }

        // Update current rate to settlement rate if there has not been a published funding rate since the dispute
        // began.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(perpetual);
        if (fundingRateRecord.proposeTime <= proposalTime) {
            fundingRateRecord.rate = settlementRate;
            fundingRateRecord.proposeTime = proposalTime;
            // Note: Set rewards to 0 since we published the DVM resolved funding rate.
            emit PublishedRate(perpetual, settlementRate.rawValue, proposalTime, proposer, 0, 0);
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
        FixedPoint.Unsigned memory pfc = FinancialContractInterface(perpetual).pfc();
        FixedPoint.Unsigned memory rewardRate = fundingRateRecord.proposal.rewardRate;
        FixedPoint.Unsigned memory reward = rewardRate.mul(pfc);

        // Pull reward payment from Perpetual, and transfer (payment + final fee bond) to proposer.
        PerpetualInterface(perpetual).withdrawFundingRateFees(reward);
        IERC20 collateralCurrency = IERC20(PerpetualInterface(perpetual).getCollateralCurrency());
        collateralCurrency.safeTransfer(
            fundingRateRecord.proposal.proposer,
            reward.add(fundingRateRecord.proposal.finalFee).rawValue
        );

        emit PublishedRate(
            perpetual,
            fundingRateRecord.proposal.rate.rawValue,
            fundingRateRecord.proposal.time,
            fundingRateRecord.proposal.proposer,
            rewardRate.rawValue,
            reward.rawValue
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
        FixedPoint.Signed memory diff = (
            currentRate.isGreaterThan(proposedRate) ? currentRate.sub(proposedRate) : proposedRate.sub(currentRate)
        );
        FixedPoint.Signed memory diffPercent = (currentRate.isEqual(0) ? diff : diff.div(currentRate));
        FixedPoint.Unsigned memory absDiffPercent = (
            diffPercent.isLessThan(FixedPoint.fromUnscaledInt(0))
                ? FixedPoint.fromSigned(diffPercent.mul(FixedPoint.fromUnscaledInt(-1)))
                : FixedPoint.fromSigned(diffPercent)
        );
        // TODO: Should we set ceiling on this
        reward = reward.mul(absDiffPercent.add(1));
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
}
