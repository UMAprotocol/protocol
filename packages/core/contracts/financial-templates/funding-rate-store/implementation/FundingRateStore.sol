pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../../oracle/interfaces/StoreInterface.sol";
import "../../../oracle/interfaces/OracleInterface.sol";
import "../../../oracle/interfaces/FinderInterface.sol";
import "../../../oracle/implementation/Constants.sol";

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";
import "../../../common/implementation/FixedPoint.sol";


contract FundingRateStore is FundingRateStoreInterface, Testable {
    using SafeMath for int256;
    using FixedPoint for FixedPoint.Unsigned;
    using FixedPoint for FixedPoint.Signed;
    using SafeERC20 for IERC20;

    /****************************************
     *      FEE PAYER DATA STRUCTURES       *
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
    event PublishedRate(bytes32 indexed identifier, int256 rate, uint256 proposalTime, address indexed proposer);
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

    function getFundingRateForIdentifier(bytes32 identifier) external override view returns (FixedPoint.Signed memory) {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);

        if (_getProposalState(fundingRateRecord.proposal) == ProposalState.Expired) {
            return fundingRateRecord.proposal.rate;
        } else {
            return fundingRateRecord.rate;
        }
    }

    function propose(bytes32 identifier, FixedPoint.Signed memory rate) external {
        // TODO: check the identifier whitelist to ensure the proposed identifier is approved by the DVM.
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);

        // TODO: bond logic.

        require(proposalState != ProposalState.Pending, "Existing proposal still pending.");

        if (proposalState == ProposalState.Expired) {
            // Publish expired rate, reward proposer.
            fundingRateRecord.rate = fundingRateRecord.proposal.rate;

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

        // Compute final fee at time of proposal.
        FixedPoint.Unsigned memory finalFeeBond = _computeFinalFees();

        uint256 currentTime = getCurrentTime();
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

    function dispute(bytes32 identifier) external {
        FundingRateRecord storage fundingRateRecord = _getFundingRateRecord(identifier);
        ProposalState proposalState = _getProposalState(fundingRateRecord.proposal);

        require(proposalState == ProposalState.Pending, "Existing proposal not pending.");

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

    function withdrawDispute(bytes32 identifier, uint256 proposalTime) external {
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

        // Update current rate to settlement rate.
        fundingRateRecords[identifier].rate = settlementRate;
        emit PublishedRate(identifier, settlementRate.rawValue, proposalTime, proposer);

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

    function _getFundingRateRecord(bytes32 identifier) private view returns (FundingRateRecord storage) {
        return fundingRateRecords[identifier];
    }

    function _getFundingRateDispute(bytes32 identifier, uint256 time) private view returns (FundingRateRecord storage) {
        return fundingRateDisputes[identifier][time];
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
