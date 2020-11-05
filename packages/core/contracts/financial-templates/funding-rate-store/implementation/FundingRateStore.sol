pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";


contract FundingRateStore is FundingRateStoreInterface, Testable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    struct Proposal {
        FixedPoint.Signed rate;
        uint256 time;
        address proposer;
    }

    struct FundingRateRecord {
        FixedPoint.Signed rate;
        Proposal proposal;
    }

    enum ProposalState { None, Pending, Expired }

    mapping(bytes32 => FundingRateRecord) public fundingRateRecords;

    uint256 public proposalLiveness;

    FixedPoint.Unsigned public fixedFundingRateFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% FundingRate fee.
    FixedPoint.Unsigned public weeklyDelayFeePerSecondPerPfc; // Percentage of 1 E.g., .1 is 10% weekly delay fee.
    uint256 public constant SECONDS_PER_WEEK = 604800;

    constructor(
        FixedPoint.Unsigned memory _fixedFundingRateFeePerSecondPerPfc,
        FixedPoint.Unsigned memory _weeklyDelayFeePerSecondPerPfc,
        uint256 _proposalLiveness,
        address _timerAddress
    ) public Testable(_timerAddress) {
        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;

        // TODO: Should we make these fee rates modifiable (by some admin) post deployment?
        fixedFundingRateFeePerSecondPerPfc = _fixedFundingRateFeePerSecondPerPfc;
        weeklyDelayFeePerSecondPerPfc = _weeklyDelayFeePerSecondPerPfc;
    }

    function getFundingRateForIdentifier(bytes32 identifier) external override view returns (FixedPoint.Signed memory) {
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

    function propose(bytes32 identifier, FixedPoint.Signed memory rate) external {
        // TODO: check the identifier whitelist to ensure the proposed identifier is approved by the DVM.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);

        // TODO: bond logic.

        require(proposalState != ProposalState.Pending, "Existing proposal still pending.");

        if (proposalState == ProposalState.Expired) {
            fundingRateRecord.rate = fundingRateRecord.proposal.rate;
        }

        fundingRateRecord.proposal = Proposal({ rate: rate, time: getCurrentTime(), proposer: msg.sender });
    }

    function _getFundingRateRecord(bytes32 identifier) private view returns (FundingRateRecord storage) {
        return fundingRateRecords[identifier];
    }

    function _getProposalState(Proposal storage proposal) private view returns (ProposalState) {
        uint256 time = proposal.time;
        if (time == 0) {
            return ProposalState.None;
        } else if (getCurrentTime() < time + proposalLiveness) {
            return ProposalState.Pending;
        } else {
            return ProposalState.Expired;
        }
    }
}
