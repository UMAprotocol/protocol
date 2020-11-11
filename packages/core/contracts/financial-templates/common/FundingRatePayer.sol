pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../funding-rate-store/interfaces/FundingRateStoreInterface.sol";
import "./FeePayer.sol";
import "../perpetual-multiparty/PerpetualInterface.sol";

/**
 * @title FundingRatePayer contract.
 * @notice Extends FeePayer by adding funding rate store payment functionality for any financial contract that needs
 * to access a funding rate. Contract is abstract as each derived contract that inherits `FundingRatePayer` must
 * implement `pfc()`.
 */

abstract contract FundingRatePayer is FeePayer, PerpetualInterface {
    /****************************************
     *      FEE PAYER DATA STRUCTURES       *
     ****************************************/

    // Identifier in funding rate store to query for.
    bytes32 public fundingRateIdentifier;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event FundingRateFeesWithdrawn(uint256 indexed fundingRateFee);

    /****************************************
     *              MODIFIERS               *
     ****************************************/

    modifier onlyFundingRateStore {
        _onlyFundingRateStore(msg.sender);
        _;
    }

    /**
     * @notice Constructs the FundingRatePayer contract. Called by child contracts.
     * @param _fundingRateIdentifier Unique identifier for DVM price feed ticker for child financial contract.
     * @param _collateralAddress ERC20 token that is used as the underlying collateral for the synthetic.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        bytes32 _fundingRateIdentifier,
        address _collateralAddress,
        address _finderAddress,
        address _timerAddress
    ) public FeePayer(_collateralAddress, _finderAddress, _timerAddress) {
        fundingRateIdentifier = _fundingRateIdentifier;
    }

    /****************************************
     *        FEE PAYMENT FUNCTIONS         *
     ****************************************/

    /**
     * @notice Sends `amount` fees to the FundingRateStore contract and debits the raw collateral accordingly.
     * @dev Callable only by the FundingRateStore. This should never revert.
     * @param amount Amount of fees to pay to FundingRateStore.
     */
    function withdrawFundingRateFees(FixedPoint.Unsigned memory amount)
        external
        override
        nonReentrant()
        onlyFundingRateStore()
    {
        FundingRateStoreInterface fundingRateStore = FundingRateStoreInterface(
            finder.getImplementationAddress("FundingRateStore")
        );
        FixedPoint.Unsigned memory collateralPool = _pfc();

        // If amount to pay or collateral pool is 0, then return early.
        if (!amount.isEqual(0) && !collateralPool.isEqual(0)) {
            FixedPoint.Unsigned memory amountToPay = (amount.isGreaterThan(collateralPool) ? collateralPool : amount);

            // Adjust cumulative fee multiplier.
            _adjustCumulativeFeeMultiplier(amountToPay, collateralPool);

            // Transfer collateral.
            collateralCurrency.safeTransfer(address(fundingRateStore), amountToPay.rawValue);

            emit FundingRateFeesWithdrawn(amountToPay.rawValue);
        }
    }

    function getFundingRateIdentifier() external view override returns (bytes32) {
        return fundingRateIdentifier;
    }

    function getCollateralCurrency() external view override returns (IERC20) {
        return collateralCurrency;
    }

    function _onlyFundingRateStore(address caller) internal view {
        require(
            caller == address(FundingRateStoreInterface(finder.getImplementationAddress("FundingRateStore"))),
            "Caller not funding rate store"
        );
    }
}
