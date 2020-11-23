pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../common/implementation/FixedPoint.sol";

/**
 * @notice External methods that the FundingRateStore needs access to.
 */
interface PerpetualInterface {
    function withdrawFundingRateFees(FixedPoint.Unsigned memory amount) external returns (FixedPoint.Unsigned memory);

    function getFundingRateIdentifier() external view returns (bytes32);

    function getCollateralCurrency() external view returns (IERC20);
}
