// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/FixedPoint.sol";

/**
 * @title Simple Perpetual Mock to serve trivial functions
 */
contract PerpetualMock {
    struct FundingRate {
        FixedPoint.Signed rate;
        bytes32 identifier;
        FixedPoint.Unsigned cumulativeMultiplier;
        uint256 updateTime;
        uint256 applicationTime;
        uint256 proposalTime;
    }

    FundingRate public fundingRate;

    function setFundingRate(FundingRate memory _fundingRate) external {
        fundingRate = _fundingRate;
    }
}
