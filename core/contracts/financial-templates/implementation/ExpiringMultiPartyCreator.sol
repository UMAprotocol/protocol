pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "./ExpiringMultiParty.sol";


/**
 * @title Expiring Multi Party Contract creator.
 * @notice Factory contract to create and register new instances of expiring multiparty contracts.
 * Responsible for constraining the parameters used to construct a new EMP.
 */
contract ExpiringMultiPartyCreator is ContractCreator, Testable {
    using FixedPoint for FixedPoint.Unsigned;

    /****************************************
     *     EMP CREATOR DATA STRUCTURES      *
     ****************************************/

    struct Params {
        uint256 expirationTimestamp;
        address collateralAddress;
        bytes32 priceFeedIdentifier;
        string syntheticName;
        string syntheticSymbol;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
        FixedPoint.Unsigned minSponsorTokens;
        address timerAddress;
    }

    /**
     * @notice Deployment Configuration Constraints.
     * @dev: These constraints can evolve over time and are initially constrained to conservative values
     * in this first iteration of an EMP creator. Technically there is nothing in the ExpiringMultiParty
     * contract requiring these constraints. However, because `createExpiringMultiParty()` is intended to
     * be the only way to create valid financial contracts that are **registered** with the
     * DVM (via `_registerContract()`), we can enforce deployment configurations here.
     **/

    // - Whitelist allowed collateral currencies.
    // Note: before an instantiation of ExpiringMultipartyCreator is approved to register contracts, voters should
    // ensure that the ownership of this collateralTokenWhitelist has been renounced (so it is effectively
    // frozen). One could also set the owner to the address of the Governor contract, but voters may find that option
    // less preferable since it would force them to take a more active role in managing this financial contract
    // template.
    AddressWhitelist public collateralTokenWhitelist;
    // - Address of TokenFactory to pass into newly constructed ExpiringMultiParty contracts
    address public tokenFactoryAddress;
    // - Discretize expirations such that they must expire on the first of each month.
    mapping(uint256 => bool) public validExpirationTimestamps;
    // - Time for pending withdrawal to be disputed: 60 minutes. Lower liveness increases sponsor usability.
    // However, this parameter is a reflection of how long we expect it to take for liquidators to identify
    // that a sponsor is undercollateralized and acquire the tokens needed to liquidate them. This is also a
    // reflection of how long a malicious sponsor would need to maintain a lower-price manipulation to get
    // their withdrawal processed maliciously (if set too low, it’s quite easy for malicious sponsors to
    // request a withdrawal and spend gas to prevent other transactions from processing until the withdrawal
    //  gets approved). Ultimately, liveness is a friction to be minimized, but not critical to system function.
    uint256 public constant STRICT_WITHDRAWAL_LIVENESS = 3600;
    // - Time for liquidation to be disputed: 60 minutes. Similar reasoning to withdrawal liveness.
    // Lower liveness is more usable for liquidators. However, the parameter is a reflection of how
    // long we expect it to take disputers to notice bad liquidations. Malicious liquidators would
    // also need to attack the base chain for this long to prevent dispute transactions from processing.
    uint256 public constant STRICT_LIQUIDATION_LIVENESS = 3600;

    event CreatedExpiringMultiParty(address indexed expiringMultiPartyAddress, address indexed partyMemberAddress);

    /**
     * @notice Constructs the ExpiringMultiPartyCreator contract.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _collateralTokenWhitelist UMA protocol contract to track whitelisted collateral.
     * @param _tokenFactoryAddress ERC20 token factory used to deploy synthetic token instances.
     * @param _timerAddress Contract that stores the current time in a testing environment.
     * Must be set to 0x0 for production environments that use live time.
     */
    constructor(
        address _finderAddress,
        address _collateralTokenWhitelist,
        address _tokenFactoryAddress,
        address _timerAddress
    ) public ContractCreator(_finderAddress) Testable(_timerAddress) {
        collateralTokenWhitelist = AddressWhitelist(_collateralTokenWhitelist);
        tokenFactoryAddress = _tokenFactoryAddress;
        uint32[16] memory timestamps = [
            1585699200, // 2020-04-01T00:00:00.000Z
            1588291200, // 2020-05-01T00:00:00.000Z
            1590969600, // 2020-06-01T00:00:00.000Z
            1593561600, // 2020-07-01T00:00:00.000Z
            1596240000, // 2020-08-01T00:00:00.000Z
            1598918400, // 2020-09-01T00:00:00.000Z
            1601510400, // 2020-10-01T00:00:00.000Z
            1604188800, // 2020-11-01T00:00:00.000Z
            1606780800, // 2020-12-01T00:00:00.000Z
            1609459200, // 2021-01-01T00:00:00.000Z
            1612137600, // 2021-02-01T00:00:00.000Z
            1614556800, // 2021-03-01T00:00:00.000Z
            1617235200, // 2021-04-01T00:00:00.000Z
            1619827200, // 2021-05-01T00:00:00.000Z
            1622505600, // 2021-06-01T00:00:00.000Z
            1625097600 // 2021-07-01T00:00:00.000Z
        ];
        for (uint256 i = 0; i < timestamps.length; i++) {
            validExpirationTimestamps[timestamps[i]] = true;
        }
    }

    /**
     * @notice Creates an instance of expiring multi party and registers it within the registry.
     * @dev caller is automatically registered as the first (and only) party member.
     * @param params is a `ConstructorParams` object from ExpiringMultiParty.
     * @return address of the deployed ExpiringMultiParty contract
     */
    function createExpiringMultiParty(Params memory params) public returns (address) {
        ExpiringMultiParty derivative = new ExpiringMultiParty(_convertParams(params));

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedExpiringMultiParty(address(derivative), msg.sender);

        return address(derivative);
    }

    /****************************************
     *          PRIVATE FUNCTIONS           *
     ****************************************/

    //  Returns if expiration timestamp is on hardcoded list.
    function _isValidTimestamp(uint256 timestamp) private view returns (bool) {
        return validExpirationTimestamps[timestamp];
    }

    // Converts createExpiringMultiParty params to ExpiringMultiParty constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (ExpiringMultiParty.ConstructorParams memory constructorParams)
    {
        // Known from creator deployment.
        constructorParams.finderAddress = finderAddress;
        constructorParams.tokenFactoryAddress = tokenFactoryAddress;

        // Enforce configuration constraints.
        require(_isValidTimestamp(params.expirationTimestamp));
        require(bytes(params.syntheticName).length != 0);
        require(bytes(params.syntheticSymbol).length != 0);
        constructorParams.withdrawalLiveness = STRICT_WITHDRAWAL_LIVENESS;
        constructorParams.liquidationLiveness = STRICT_LIQUIDATION_LIVENESS;
        require(collateralTokenWhitelist.isOnWhitelist(params.collateralAddress));

        // Input from function call.
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.collateralAddress = params.collateralAddress;
        constructorParams.priceFeedIdentifier = params.priceFeedIdentifier;
        constructorParams.syntheticName = params.syntheticName;
        constructorParams.syntheticSymbol = params.syntheticSymbol;
        constructorParams.collateralRequirement = params.collateralRequirement;
        constructorParams.disputeBondPct = params.disputeBondPct;
        constructorParams.sponsorDisputeRewardPct = params.sponsorDisputeRewardPct;
        constructorParams.disputerDisputeRewardPct = params.disputerDisputeRewardPct;
        constructorParams.minSponsorTokens = params.minSponsorTokens;
        constructorParams.timerAddress = params.timerAddress;
    }
}
