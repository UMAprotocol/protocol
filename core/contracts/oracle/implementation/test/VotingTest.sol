pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../Voting.sol";
import "../../../common/implementation/FixedPoint.sol";


// Test contract used to access internal variables in the Voting contract.
contract VotingTest is Voting {
    constructor(
        uint256 _phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate,
        uint256 _rewardsExpirationTimeout,
        address _votingToken,
        address _identifierWhitelist,
        address _finder,
        bool _isTest
    )
        public
        Voting(
            _phaseLength,
            _gatPercentage,
            _inflationRate,
            _rewardsExpirationTimeout,
            _votingToken,
            _identifierWhitelist,
            _finder,
            _isTest
        )
    {}

    function getPendingPriceRequestsArray() external view returns (bytes32[] memory) {
        return pendingPriceRequests;
    }
}
