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
import "../../../common/implementation/FixedPoint.sol";


contract FundingRateStore is FundingRateStoreInterface, Testable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;

    /****************************************
     *        STORE DATA STRUCTURES         *
     ****************************************/

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
        FixedPoint.Signed rate;
        uint256 publishTime;
        Proposal proposal;
    }

    enum ProposalState { None, Pending, Expired }

    mapping(bytes32 => FundingRateRecord) public fundingRateRecords;
    mapping(bytes32 => mapping(uint256 => FundingRateRecord)) public fundingRateDisputes;

    uint256 public proposalLiveness;

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
    event PublishedRate(
        bytes32 indexed identifier,
        int256 rate,
        uint256 proposalTime,
        address indexed proposer,
        uint256 publishTime
    );
    event FinalFeesPaid(uint256 indexed amount);

    constructor(
        uint256 _proposalLiveness,
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    ) public Testable(_timerAddress) {
        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;
        collateralCurrency = IERC20(_collateralAddress);
        finder = FinderInterface(_finderAddress);
    }

    /**
     * @notice Returns the current funding rate or the pending funding rate if its liveness has expired.
     * @param identifier Identifier to retrieve funding rate for.
     * @return funding rate.
     */
    function getFundingRateForIdentifier(bytes32 identifier) external override view returns (FixedPoint.Signed memory) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.rate;
        } else {
            return fundingRateRecord.rate;
        }
    }

    /**
     * @notice Returns the timestamp at which the current funding rate was published.
     * @dev The "current funding rate" is defined as that returned by `getFundingRateForIdentifier(id)`
     * @param identifier Identifier to retrieve publish time for.
     * @return publish timestamp.
     */
    function getLastPublishTimeForIdentifier(bytes32 identifier) external view returns (uint256) {
        return _getLastPublishTimeForIdentifier(identifier);
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
    function propose(bytes32 identifier, FixedPoint.Signed memory rate) external {
        // TODO: check the identifier whitelist to ensure the proposed identifier is approved by the DVM.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);
        uint256 currentTime = getCurrentTime();

        // TODO: bond logic.

        require(proposalState != ProposalState.Pending, "Existing proposal still pending.");

        if (proposalState == ProposalState.Expired) {
            // Publish expired rate, reward proposer.
            fundingRateRecord.rate = fundingRateRecord.proposal.rate;
            fundingRateRecord.publishTime = currentTime;

            // TODO: Reward = proposal bond
            collateralCurrency.safeTransfer(
                fundingRateRecord.proposal.proposer,
                fundingRateRecord.proposal.finalFee.rawValue
            );

            emit PublishedRate(
                identifier,
                fundingRateRecord.rate.rawValue,
                fundingRateRecord.proposal.time,
                fundingRateRecord.proposal.proposer,
                currentTime
            );
        }

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
    function dispute(bytes32 identifier) external {
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
    function settleDispute(bytes32 identifier, uint256 proposalTime) external {
        FundingRateRecord storage fundingRateDispute = _getFundingRateDispute(identifier, proposalTime);

        // Get the returned funding rate from the oracle. If this has not yet resolved will revert.
        // If the fundingRateDispute struct has been deleted, then this call will also fail because the proposal
        // time will be 0.
        FixedPoint.Signed memory settlementRate = _getOraclePrice(identifier, fundingRateDispute.proposal.time);

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
        if (_getLastPublishTimeForIdentifier(identifier) <= fundingRateDispute.proposal.time) {
            FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
            uint256 currentTime = getCurrentTime();
            fundingRateRecord.rate = settlementRate;
            fundingRateRecord.publishTime = currentTime;
            emit PublishedRate(identifier, settlementRate.rawValue, proposalTime, proposer, currentTime);
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
        } else if (getCurrentTime() < time + proposalLiveness) {
            return ProposalState.Pending;
        } else {
            return ProposalState.Expired;
        }
    }

    function _getLastPublishTimeForIdentifier(bytes32 identifier) internal view returns (uint256) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        // If a pending funding rate has expired, then the timestamp at which it expired is the last publish time.
        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.time + proposalLiveness;
        } else {
            return fundingRateRecord.publishTime;
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
