pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";

import "../../oracle/interfaces/StoreInterface.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

import "../funding-rate-store/interfaces/FundingRateStoreInterface.sol";


/**
 * @title FundingRateApplier contract.
 */

abstract contract FundingRateApplier is Testable, Lockable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;

    /****************************************
     * FUNDING RATE APPLIER DATA STRUCTURES *
     ****************************************/

    FinderInterface public fpFinder;

    uint256 lastUpdateTime;

    bytes32 identifer;

    int256 lastUpdateFundingRate;

    FixedPoint.Unsigned public cumulativeFundingRateMultiplier;

    /****************************************
     *                EVENTS                *
     ****************************************/

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier updateFunding {
        _updateFunding();
        _;
    }

    constructor(
        uint256 _initialFundingRate,
        address _fpFinderAddress,
        address _timerAddress,
        bytes32 _identifer
    ) public Testable(_timerAddress) nonReentrant() {
        cumulativeFundingRateMultiplier = FixedPoint.fromUnscaledUint(_initialFundingRate);
        fpFinder = FinderInterface(_fpFinderAddress);
        lastUpdateTime = getCurrentTime();
        identifer = _identifer;
    }

    function _getFundingRateAppliedTokenDebt(FixedPoint.Unsigned memory rawTokenDebt)
        internal
        view
        returns (FixedPoint.Unsigned memory tokenDebt)
    {
        return rawTokenDebt.mul(cumulativeFundingRateMultiplier);
    }

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    function _updateFunding() internal {
        int256 latestFundingRate = _getLatestFundingRate();
        if (lastUpdateFundingRate != latestFundingRate) {
            lastUpdateFundingRate = latestFundingRate;
        }
    }

    function _getFundingRateStore() internal view returns (FundingRateStoreInterface) {
        return FundingRateStoreInterface(fpFinder.getImplementationAddress("FundingRateStore"));
    }

    function _getLatestFundingRate() internal view returns (int256) {
        FundingRateStoreInterface fundingRateStore = _getFundingRateStore();
        return fundingRateStore.getLatestFundingRateForIdentifier(identifer);
    }
}
