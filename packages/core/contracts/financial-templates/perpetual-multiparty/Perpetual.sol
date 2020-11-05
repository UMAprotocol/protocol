pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./PerpetualLiquidatable.sol";
import "./PerpetualInterface.sol";


/**
 * @title Perpetual Multiparty Contract.
 * @notice Convenient wrapper for Liquidatable.
 */
contract Perpetual is PerpetualInterface, PerpetualLiquidatable {
    function getFundingRateIdentifier() external override returns (bytes32) {
        return fundingRateIdentifier;
    }

    function getCollateralCurrency() external override returns (IERC20) {
        return collateralCurrency;
    }

    /**
     * @notice Constructs the Perpetual contract.
     * @param params struct to define input parameters for construction of Liquidatable. Some params
     * are fed directly into the PositionManager's constructor within the inheritance tree.
     */
    constructor(ConstructorParams memory params)
        public
        PerpetualLiquidatable(params)
    // Note: since there is no logic here, there is no need to add a re-entrancy guard.
    {

    }
}
