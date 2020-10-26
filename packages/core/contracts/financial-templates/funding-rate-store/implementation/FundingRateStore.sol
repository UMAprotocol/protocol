pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../interfaces/FundingRateStoreInterface.sol";
import "../../../common/implementation/Testable.sol";


contract FundingRateStore is FundingRateStoreInterface, Testable {
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

    constructor(uint256 _proposalLiveness, address _timerAddress) public Testable(_timerAddress) {
        require(_proposalLiveness > 0, "Proposal liveness is 0");
        proposalLiveness = _proposalLiveness;
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
        // TODO: ACLS on identifiers that can be proposed.
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
