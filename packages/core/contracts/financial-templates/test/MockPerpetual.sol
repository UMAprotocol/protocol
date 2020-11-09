pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../perpetual-multiparty/PerpetualInterface.sol";
import "../../financial-templates/funding-rate-store/interfaces/FundingRateStoreInterface.sol";

/**
 * @notice External methods that the FundingRateStore needs access to.
 */
contract MockPerpetual is PerpetualInterface {
    using SafeERC20 for IERC20;
    IERC20 private collateralCurrency;
    bytes32 private fundingRateIdentifier;

    constructor(bytes32 _fundingRateIdentifier, address _collateralCurrency) public {
        fundingRateIdentifier = _fundingRateIdentifier;
        collateralCurrency = IERC20(_collateralCurrency);
    }

    function getFundingRateIdentifier() external view override returns (bytes32) {
        return fundingRateIdentifier;
    }

    function getCollateralCurrency() external view override returns (IERC20) {
        return collateralCurrency;
    }

    function payFundingRateFees(FixedPoint.Unsigned memory amount) external override {
        return;
    }
}
