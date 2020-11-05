pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @notice External methods that the FundingRateStore needs access to.
 */
interface PerpetualInterface {
    function getFundingRateIdentifier() external returns (bytes32);

    function getCollateralCurrency() external returns (IERC20);
}
