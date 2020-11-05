pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../../../oracle/interfaces/StoreInterface.sol";
import "../../../oracle/interfaces/OracleInterface.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/Lockable.sol";
import "../../../common/implementation/Withdrawable.sol";
import "../../../common/implementation/FixedPoint.sol";


contract FundingRateStore is FundingRateStoreInterface, Withdrawable, Testable, Lockable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;

    /****************************************
     *        STORE DATA STRUCTURES         *
     ****************************************/

    enum Roles { Owner, Withdrawer }

    // TODO: Remove this hardcoded `collateralCurrency` and dynamically reward proposers
    // in the same currency that the financial contract client's collateral is denominated in.
    // i.e. USDBTC Perp is collateralized by tBTC, it should pay fees to this contract in tBTC,
    // and it should reward proposers in tBTC.
    // The collateral currency used to reward successful proposers.
    IERC20 public collateralCurrency;

    // Finder contract used to look up addresses for UMA system contracts.
    FinderInterface public finder;

    struct Proposal {
        FixedPoint.Signed rate;
        uint256 time;
        address proposer;
        FixedPoint.Unsigned finalFee;
        address disputer;
    }

    struct FundingRateRecord {
        FixedPoint.Signed rate; // Current funding rate.
        uint256 proposeTime; // Time at which current funding rate was proposed.
        Proposal proposal;
    }

    enum ProposalState { None, Pending, Expired }

    mapping(bytes32 => FundingRateRecord) public fundingRateRecords;
    mapping(bytes32 => mapping(uint256 => FundingRateRecord)) public fundingRateDisputes;

    uint256 public proposalLiveness;

    FixedPoint.Unsigned public fixedFundingRateFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% FundingRate fee.
    FixedPoint.Unsigned public weeklyDelayFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% weekly delay fee.
    uint256 public constant SECONDS_PER_WEEK = 604800;
    /****************************************
     *                EVENTS                *
     ****************************************/

    event ProposedRate(bytes32 indexed identifier, int256 rate, uint256 proposalTime, address indexed proposer);
    event DisputedRate(
        bytes32 indexed identifier,
        int256 rate,
        uint256 proposalTime,
        address indexed proposer,
        address indexed disputer
    );
    event PublishedRate(bytes32 indexed identifier, int256 rate, uint256 proposalTime, address indexed proposer);
    event FinalFeesPaid(uint256 indexed amount);

    constructor(
        FixedPoint.Unsigned memory _fixedFundingRateFeePerSecondPerPfc,
        FixedPoint.Unsigned memory _weeklyDelayFeePerSecondPerPfc,
        uint256 _proposalLiveness,
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    ) public Testable(_timerAddress) {
        // TODO: Should we make the Perpetual contract the withdrawer of this Store?
        _createExclusiveRole(uint256(Roles.Owner), uint256(Roles.Owner), msg.sender);
        _createWithdrawRole(uint256(Roles.Withdrawer), uint256(Roles.Owner), msg.sender);

        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;
        collateralCurrency = IERC20(_collateralAddress);
        finder = FinderInterface(_finderAddress);

        // Continuous fees at or over 100% don't make sense.
        require(_fixedFundingRateFeePerSecondPerPfc.isLessThan(1), "Fee must be < 100% per second.");
        require(_weeklyDelayFeePerSecondPerPfc.isLessThan(1), "weekly delay fee must be < 100%");

        // TODO: Should we make these fee rates modifiable (by some admin) post deployment?
        fixedFundingRateFeePerSecondPerPfc = _fixedFundingRateFeePerSecondPerPfc;
        weeklyDelayFeePerSecondPerPfc = _weeklyDelayFeePerSecondPerPfc;
    }

    /**
     * @notice Returns the current funding rate or the pending funding rate if its liveness has expired.
     * @param identifier Identifier to retrieve funding rate for.
     * @return funding rate.
     */
    function getFundingRateForIdentifier(bytes32 identifier)
        external
        override
        view
        nonReentrantView()
        returns (FixedPoint.Signed memory)
    {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.rate;
        } else {
            return fundingRateRecord.rate;
        }
    }

    /**
     * @notice Computes the funding rate fees that a contract should pay for a period.
     * @dev The late penalty is similar to the funding rate fee in that is is charged per second over the period
     * between startTime and endTime.
     *
     * The late penalty percentage increases over time as follows:
     *
     * - 0-1 week since startTime: no late penalty
     *
     * - 1-2 weeks since startTime: 1x late penalty percentage is applied
     *
     * - 2-3 weeks since startTime: 2x late penalty percentage is applied
     *
     * - ...
     *
     * @param startTime defines the beginning time from which the fee is paid.
     * @param endTime end time until which the fee is paid.
     * @param pfc "profit from corruption", or the maximum amount of margin currency that a
     * token sponsor could extract from the contract through corrupting the price feed in their favor.
     * @return fundingRateFee amount owed for the duration from start to end time for the given pfc.
     * @return latePenalty penalty percentage, if any, for paying the fee after the deadline.
     */
    function computeFundingRateFee(
        uint256 startTime,
        uint256 endTime,
        FixedPoint.Unsigned calldata pfc
    )
        external
        override
        view
        returns (FixedPoint.Unsigned memory fundingRateFee, FixedPoint.Unsigned memory latePenalty)
    {
        uint256 timeDiff = endTime.sub(startTime);

        // Multiply by the unscaled `timeDiff` first, to get more accurate results.
        fundingRateFee = pfc.mul(timeDiff).mul(fixedFundingRateFeePerSecondPerPfc);

        // Compute how long ago the start time was to compute the delay penalty.
        uint256 paymentDelay = getCurrentTime().sub(startTime);

        // Compute the additional percentage (per second) that will be charged because of the penalty.
        // Note: if less than a week has gone by since the startTime, paymentDelay / SECONDS_PER_WEEK will truncate to
        // 0, causing no penalty to be charged.
        FixedPoint.Unsigned memory penaltyPercentagePerSecond = weeklyDelayFeePerSecondPerPfc.mul(
            paymentDelay.div(SECONDS_PER_WEEK)
        );

        // Apply the penaltyPercentagePerSecond to the payment period.
        latePenalty = pfc.mul(timeDiff).mul(penaltyPercentagePerSecond);
    }

    /**
     * @notice Pays funding rate fees in the margin currency, erc20Address, to the store.
     * @dev To be used if the margin currency is an ERC20 token rather than ETH.
     * @param erc20Address address of the ERC20 token used to pay the fee.
     * @param amount number of tokens to transfer. An approval for at least this amount must exist.
     */
    function payFundingRateFeesErc20(address erc20Address, FixedPoint.Unsigned calldata amount) external override {
        IERC20 erc20 = IERC20(erc20Address);
        require(amount.isGreaterThan(0), "Amount sent can't be zero");
        erc20.safeTransferFrom(msg.sender, address(this), amount.rawValue);
    }

    /**
     * @notice Returns the timestamp at which the current funding rate was proposed.
     * @dev The "current funding rate" is defined as that returned by `getFundingRateForIdentifier(id)`
     * @param identifier Identifier to retrieve propose time for.
     * @return propose timestamp.
     */
    function getProposeTimeForIdentifier(bytes32 identifier) external view nonReentrantView() returns (uint256) {
        return _getLatestProposeTimeForIdentifier(identifier);
    }

    /**
     * @notice Propose a new funding rate for an identifier. A side effect of this method is that it will
     * overwrite the current funding rate with a pending funding rate if its liveness has expired. If this update
     * occurs, then this method will also pay the proposer their reward for successfully updating the current rate.
     * @dev This will revert if there is already a pending funding rate for the identifier.
     * @dev Caller must approve this this contract to spend `finalFeeBond` amount of collateral, which they can
     * receive back once their funding rate is published.
     * @param identifier Identifier to propose funding rate for.
     * @param rate Proposed rate.
     */
    function propose(bytes32 identifier, FixedPoint.Signed memory rate) external nonReentrant() {
        // TODO: check the identifier whitelist to ensure the proposed identifier is approved by the DVM.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);
        uint256 currentTime = getCurrentTime();

        // TODO: bond logic.

        require(proposalState != ProposalState.Pending, "Existing proposal still pending.");

        // Update the current funding rate if a proposal's liveness has expired.
        if (proposalState == ProposalState.Expired) {
            // Publish expired rate, and then reward proposer.
            fundingRateRecord.rate = fundingRateRecord.proposal.rate;
            fundingRateRecord.proposeTime = fundingRateRecord.proposal.time;

            // TODO: Reward = proposal bond
            collateralCurrency.safeTransfer(
                fundingRateRecord.proposal.proposer,
                fundingRateRecord.proposal.finalFee.rawValue
            );

            emit PublishedRate(
                identifier,
                fundingRateRecord.rate.rawValue,
                fundingRateRecord.proposal.time,
                fundingRateRecord.proposal.proposer
            );
        }

        // Make sure that there is no disputed proposal for the same identifier and proposal time. This prevents
        // the proposer from potentially overwriting a proposal. Note that this would be a rare case in which the
        // proposer [ (1) created a proposal, (2) disputed the proposal, and (3) created another proposal ] all within
        // the same block. The proposer would lose their bond from the first proposal forever.
        require(
            _getFundingRateDispute(identifier, currentTime).proposal.proposer == address(0x0),
            "Proposal pending dispute"
        );

        // Compute final fee at time of proposal.
        FixedPoint.Unsigned memory finalFeeBond = _computeFinalFees();

        fundingRateRecord.proposal = Proposal({
            rate: rate,
            time: currentTime,
            proposer: msg.sender,
            finalFee: finalFeeBond,
            disputer: address(0x0)
        });
        emit ProposedRate(identifier, rate.rawValue, currentTime, msg.sender);

        // Pull final fee bond from proposer.
        collateralCurrency.safeTransferFrom(msg.sender, address(this), finalFeeBond.rawValue);
    }

    /**
     * @notice Dispute a pending funding rate. This will delete the pending funding rate, meaning that a
     * proposer can now proposer another rate with a fresh liveness.
     * @dev This will revert if there is no pending funding rate for the identifier.
     * @dev Caller must approve this this contract to spend `finalFeeBond` amount of collateral, which they can
     * receive back if their dispute is successful.
     * @param identifier Identifier to dispute proposed funding rate for.
     */
    function dispute(bytes32 identifier) external nonReentrant() {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);

        require(proposalState == ProposalState.Pending, "Existing proposal not pending");

        // TODO: Bond logic.

        // Pull final fee bond from disputer and pay store.
        _payFinalFees(msg.sender, fundingRateRecord.proposal.finalFee);

        // Send price request
        _requestOraclePrice(identifier, fundingRateRecord.proposal.time);

        emit DisputedRate(
            identifier,
            fundingRateRecord.proposal.rate.rawValue,
            fundingRateRecord.proposal.time,
            fundingRateRecord.proposal.proposer,
            msg.sender
        );

        // Delete pending proposal and copy into dispute records.
        fundingRateRecord.proposal.disputer = msg.sender;
        fundingRateDisputes[identifier][fundingRateRecord.proposal.time] = fundingRateRecord;
        delete fundingRateRecords[identifier].proposal;
    }

    /**
     * @notice Settle a disputed funding rate. The winner of the dispute, either the disputer or the proposer,
     * will receive a reward plus their final fee bond. This method will also overwrite the current funding rate
     * with the resolved funding rate returned by the Oracle. Pending funding rates are unaffected by this method.
     * @dev This will revert if there is no price available for the disputed funding rate.
     * @param identifier Identifier to settle disputed funding rate for.
     * @param proposalTime Proposal time at which the disputed funding rate was proposed.
     */
    function settleDispute(bytes32 identifier, uint256 proposalTime) external nonReentrant() {
        FundingRateRecord storage fundingRateDispute = _getFundingRateDispute(identifier, proposalTime);

        // Get the returned funding rate from the oracle. If this has not yet resolved will revert.
        // If the fundingRateDispute struct has been deleted, then this call will also fail because the proposal
        // time will be 0.
        FixedPoint.Signed memory settlementRate = _getOraclePrice(identifier, proposalTime);

        // Dispute was successful if settled rate is different from proposed rate.
        bool disputeSucceeded = !settlementRate.isEqual(fundingRateDispute.proposal.rate);
        address proposer = disputeSucceeded
            ? fundingRateDispute.proposal.disputer
            : fundingRateDispute.proposal.proposer;

        if (disputeSucceeded) {
            // If dispute succeeds:
            // - pay disputer the dispute reward + final fee rebate

            collateralCurrency.safeTransfer(
                fundingRateDispute.proposal.disputer,
                fundingRateDispute.proposal.finalFee.rawValue
            );
        } else {
            // If dispute fails:
            // - pay proposer the proposal reward + final fee rebate

            collateralCurrency.safeTransfer(
                fundingRateDispute.proposal.proposer,
                fundingRateDispute.proposal.finalFee.rawValue
            );
        }

        // Update current rate to settlement rate if there has not been a published funding rate since the dispute
        // began.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        if (_getLatestProposeTimeForIdentifier(identifier) <= proposalTime) {
            fundingRateRecord.rate = settlementRate;
            fundingRateRecord.proposeTime = proposalTime;
            emit PublishedRate(identifier, settlementRate.rawValue, proposalTime, proposer);
        }

        // Delete dispute
        delete fundingRateDisputes[identifier][proposalTime];
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    // Requests a price for `priceIdentifier` at `requestedTime` from the Oracle.
    function _requestOraclePrice(bytes32 identifier, uint256 requestedTime) internal {
        OracleInterface oracle = _getOracle();
        oracle.requestPrice(identifier, requestedTime);
    }

    // Pays UMA Oracle final fees of `amount` in `collateralCurrency` to the Store contract. Final fee is a flat fee
    // charged for each price request.
    function _payFinalFees(address payer, FixedPoint.Unsigned memory amount) internal {
        if (amount.isEqual(0)) {
            return;
        }

        collateralCurrency.safeTransferFrom(payer, address(this), amount.rawValue);

        emit FinalFeesPaid(amount.rawValue);

        StoreInterface store = _getStore();
        collateralCurrency.safeIncreaseAllowance(address(store), amount.rawValue);
        store.payOracleFeesErc20(address(collateralCurrency), amount);
    }

    // Returns the pending Proposal struct for an identifier.
    function _getFundingRateRecord(bytes32 identifier) private view returns (FundingRateRecord storage) {
        return fundingRateRecords[identifier];
    }

    // Returns the disputed Proposal struct for an identifier and proposal time. This returns empty if the dispute
    // has already been resolved via `settleDispute`.
    function _getFundingRateDispute(bytes32 identifier, uint256 time) private view returns (FundingRateRecord storage) {
        return fundingRateDisputes[identifier][time];
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

    function _getLatestProposeTimeForIdentifier(bytes32 identifier) internal view returns (uint256) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        // If a pending funding rate has expired, then use the pending funding rate's proposal time.
        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.time;
        } else {
            return fundingRateRecord.proposeTime;
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

    function _computeFinalFees() internal view returns (FixedPoint.Unsigned memory finalFees) {
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
