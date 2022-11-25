// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../data-verification-mechanism/implementation/ContractCreator.sol";
import "../../common/interfaces/ExpandedIERC20.sol";
import "../../common/interfaces/IERC20Standard.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "../../common/implementation/Lockable.sol";
import "../common/TokenFactory.sol";
import "../common/SyntheticToken.sol";
import "./PerpetualLib.sol";
import "./ConfigStore.sol";

/**
 * @title Perpetual Contract creator.
 * @notice Factory contract to create and register new instances of perpetual contracts.
 * Responsible for constraining the parameters used to construct a new perpetual. This creator contains a number of constraints
 * that are applied to newly created contract. These constraints can evolve over time and are
 * initially constrained to conservative values in this first iteration. Technically there is nothing in the
 * Perpetual contract requiring these constraints. However, because `createPerpetual()` is intended
 * to be the only way to create valid financial contracts that are registered with the DVM (via _registerContract),
  we can enforce deployment configurations here.
 */
contract PerpetualCreator is ContractCreator, Testable, Lockable {
    using FixedPoint for FixedPoint.Unsigned;

    /****************************************
     *     PERP CREATOR DATA STRUCTURES      *
     ****************************************/

    // Immutable params for perpetual contract.
    struct Params {
        address collateralAddress;
        bytes32 priceFeedIdentifier;
        bytes32 fundingRateIdentifier;
        string syntheticName;
        string syntheticSymbol;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPercentage;
        FixedPoint.Unsigned sponsorDisputeRewardPercentage;
        FixedPoint.Unsigned disputerDisputeRewardPercentage;
        FixedPoint.Unsigned minSponsorTokens;
        FixedPoint.Unsigned tokenScaling;
        uint256 withdrawalLiveness;
        uint256 liquidationLiveness;
    }
    // Address of TokenFactory used to create a new synthetic token.
    address public tokenFactoryAddress;

    event CreatedPerpetual(address indexed perpetualAddress, address indexed deployerAddress);
    event CreatedConfigStore(address indexed configStoreAddress, address indexed ownerAddress);

    /**
     * @notice Constructs the Perpetual contract.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _tokenFactoryAddress ERC20 token factory used to deploy synthetic token instances.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     */
    constructor(
        address _finderAddress,
        address _tokenFactoryAddress,
        address _timerAddress
    ) ContractCreator(_finderAddress) Testable(_timerAddress) nonReentrant() {
        tokenFactoryAddress = _tokenFactoryAddress;
    }

    /**
     * @notice Creates an instance of perpetual and registers it within the registry.
     * @param params is a `ConstructorParams` object from Perpetual.
     * @return address of the deployed contract.
     */
    function createPerpetual(Params memory params, ConfigStore.ConfigSettings memory configSettings)
        public
        nonReentrant()
        returns (address)
    {
        require(bytes(params.syntheticName).length != 0, "Missing synthetic name");
        require(bytes(params.syntheticSymbol).length != 0, "Missing synthetic symbol");

        // Create new config settings store for this contract and reset ownership to the deployer.
        ConfigStore configStore = new ConfigStore(configSettings, timerAddress);
        configStore.transferOwnership(msg.sender);
        emit CreatedConfigStore(address(configStore), configStore.owner());

        // Create a new synthetic token using the params.
        TokenFactory tf = TokenFactory(tokenFactoryAddress);

        // If the collateral token does not have a `decimals()` method,
        // then a default precision of 18 will be applied to the newly created synthetic token.
        uint8 syntheticDecimals = _getSyntheticDecimals(params.collateralAddress);
        ExpandedIERC20 tokenCurrency = tf.createToken(params.syntheticName, params.syntheticSymbol, syntheticDecimals);
        address derivative = PerpetualLib.deploy(_convertParams(params, tokenCurrency, address(configStore)));

        // Give permissions to new derivative contract and then hand over ownership.
        tokenCurrency.addMinter(derivative);
        tokenCurrency.addBurner(derivative);
        tokenCurrency.resetOwner(derivative);

        _registerContract(new address[](0), derivative);

        emit CreatedPerpetual(derivative, msg.sender);

        return derivative;
    }

    /****************************************
     *          PRIVATE FUNCTIONS           *
     ****************************************/

    // Converts createPerpetual params to Perpetual constructor params.
    function _convertParams(
        Params memory params,
        ExpandedIERC20 newTokenCurrency,
        address configStore
    ) private view returns (Perpetual.ConstructorParams memory constructorParams) {
        // Known from creator deployment.
        constructorParams.finderAddress = finderAddress;
        constructorParams.timerAddress = timerAddress;

        // Enforce configuration constraints.
        require(params.withdrawalLiveness != 0, "Withdrawal liveness cannot be 0");
        require(params.liquidationLiveness != 0, "Liquidation liveness cannot be 0");
        _requireWhitelistedCollateral(params.collateralAddress);

        // We don't want perpetual deployers to be able to intentionally or unintentionally set
        // liveness periods that could induce arithmetic overflow, but we also don't want
        // to be opinionated about what livenesses are "correct", so we will somewhat
        // arbitrarily set the liveness upper bound to 100 years (5200 weeks). In practice, liveness
        // periods even greater than a few days would make the perpetual unusable for most users.
        require(params.withdrawalLiveness < 5200 weeks, "Withdrawal liveness too large");
        require(params.liquidationLiveness < 5200 weeks, "Liquidation liveness too large");

        // To avoid precision loss or overflows, prevent the token scaling from being too large or too small.
        FixedPoint.Unsigned memory minScaling = FixedPoint.Unsigned(1e8); // 1e-10
        FixedPoint.Unsigned memory maxScaling = FixedPoint.Unsigned(1e28); // 1e10
        require(
            params.tokenScaling.isGreaterThan(minScaling) && params.tokenScaling.isLessThan(maxScaling),
            "Invalid tokenScaling"
        );

        // Input from function call.
        constructorParams.configStoreAddress = configStore;
        constructorParams.tokenAddress = address(newTokenCurrency);
        constructorParams.collateralAddress = params.collateralAddress;
        constructorParams.priceFeedIdentifier = params.priceFeedIdentifier;
        constructorParams.fundingRateIdentifier = params.fundingRateIdentifier;
        constructorParams.collateralRequirement = params.collateralRequirement;
        constructorParams.disputeBondPercentage = params.disputeBondPercentage;
        constructorParams.sponsorDisputeRewardPercentage = params.sponsorDisputeRewardPercentage;
        constructorParams.disputerDisputeRewardPercentage = params.disputerDisputeRewardPercentage;
        constructorParams.minSponsorTokens = params.minSponsorTokens;
        constructorParams.withdrawalLiveness = params.withdrawalLiveness;
        constructorParams.liquidationLiveness = params.liquidationLiveness;
        constructorParams.tokenScaling = params.tokenScaling;
    }

    // IERC20Standard.decimals() will revert if the collateral contract has not implemented the decimals() method,
    // which is possible since the method is only an OPTIONAL method in the ERC20 standard:
    // https://eips.ethereum.org/EIPS/eip-20#methods.
    function _getSyntheticDecimals(address _collateralAddress) public view returns (uint8 decimals) {
        try IERC20Standard(_collateralAddress).decimals() returns (uint8 _decimals) {
            return _decimals;
        } catch {
            return 18;
        }
    }
}
