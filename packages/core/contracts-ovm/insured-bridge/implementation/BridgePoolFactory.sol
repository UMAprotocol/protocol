// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// Importing local copies of OVM contracts is a temporary fix until the @eth-optimism/contracts package exports 0.8.x
// contracts. These contracts are relatively small and should have no problems porting from 0.7.x to 0.8.x, and
// changing their version is preferable to changing this contract to 0.7.x and defining compatible interfaces for all
// of the imported DVM contracts below.
import "./OVM_CrossDomainEnabled.sol";
import "./BridgePoolFactoryInterface.sol";
import "../../../contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/interfaces/AddressWhitelistInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Administrative contract deployed on L1 that has an implicit reference to a DepositBox. This contract is
 * responsible for deploying new BridgePools, which houses passive liquidity and enables relaying of L2 deposits.
 * @dev The owner of this contract can call permissioned functions on the L2 DepositBox.
 */
contract BridgePoolFactory is BridgePoolFactoryInterface, Ownable, OVM_CrossDomainEnabled {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address private finder;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address private depositContract;

    mapping(address => L1TokenRelationships) private whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint256 private optimisticOracleLiveness;
    uint256 private proposerBondPct;
    bytes32 private identifier;

    event SetDepositContract(address indexed l2DepositContract);
    event SetRelayIdentifier(bytes32 indexed identifier);
    event SetOptimisticOracleLiveness(uint256 indexed liveness);
    event SetProposerBondPct(uint256 indexed proposerBondPct);
    event WhitelistToken(address indexed l1Token, address indexed l2Token, address indexed bridgePool);

    constructor(
        address _finder,
        address _crossDomainMessenger,
        uint256 _optimisticOracleLiveness,
        uint256 _proposerBondPct,
        bytes32 _identifier
    ) OVM_CrossDomainEnabled(_crossDomainMessenger) {
        finder = _finder;
        require(address(_getCollateralWhitelist()) != address(0), "Invalid finder");
        _setOptimisticOracleLiveness(_optimisticOracleLiveness);
        _setProposerBondPct(_proposerBondPct);
        _setIdentifier(_identifier);
    }

    // Admin functions

    /**
     * @dev Sets new price identifier to use for relayed deposits. BridgePools will read the identifier from this
     * contract. Can only be called by the current owner.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        _setIdentifier(_identifier);
    }

    /**
     * @dev Sets challenge pereiod for relayed deposits. BridgePools will read this value from this
     * contract. Can only be called by the current owner.
     */
    function setOptimisticOracleLiveness(uint256 _liveness) public onlyOwner {
        _setOptimisticOracleLiveness(_liveness);
    }

    /**
     * @dev Sets challenge pereiod for relayed deposits. BridgePools will read this value from this
     * contract. Can only be called by the current owner.
     */
    function setProposerBondPct(uint256 _proposerBondPct) public onlyOwner {
        _setProposerBondPct(_proposerBondPct);
    }

    /**
     * @notice Privileged account can set L2 deposit contract that originates deposit orders to be fulfilled by this
     * contract.
     * @dev Only callable by Owner of this contract.
     * @param _depositContract Address of L2 deposit contract.
     */
    function setDepositContract(address _depositContract) public onlyOwner {
        depositContract = _depositContract;
        emit SetDepositContract(depositContract);
    }

    /**
     * @notice Privileged account can associate a whitelisted token with its linked token address on L2 and its
     * BridgePool address on this network. The linked L2 token can thereafter be deposited into the Deposit contract
     * on L2 and relayed via the BridgePool contract.
     * @dev Only callable by Owner of this contract. Also initiates a cross-chain call to the L2 Deposit contract to
     * whitelist the token mapping.
     * @param _l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param _l2Token Address of L2 token whose deposits are fulfilled by `_l1Token`.
     * @param _bridgePool Address of pool contract that stores passive liquidity with which to fulfill deposits.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function whitelistToken(
        address _l1Token,
        address _l2Token,
        address _bridgePool,
        uint32 _l2Gas
    ) public onlyOwner {
        require(_getCollateralWhitelist().isOnWhitelist(address(_l1Token)), "Payment token not whitelisted");
        // We want to prevent any situation where a token mapping is whitelisted on this contract but not on the
        // corresponding L2 contract.
        require(depositContract != address(0), "Deposit contract not set");

        L1TokenRelationships storage whitelistedToken = whitelistedTokens[_l1Token];
        whitelistedToken.l2Token = _l2Token;
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("whitelistToken(address,address)", _l1Token, whitelistedToken.l2Token)
        );

        // TODO: This contract should deploy a new BridgePool if the address is set to 0x0 at this point.
        whitelistedToken.bridgePool = _bridgePool;

        emit WhitelistToken(_l1Token, whitelistedToken.l2Token, whitelistedToken.bridgePool);
    }

    function pauseL2Deposits() public onlyOwner {}

    // Interface view methods exposed to child BridgePool contracts.
    function getFinder() external view override returns (address) {
        return finder;
    }

    function getDepositContract() external view override returns (address) {
        return depositContract;
    }

    function getWhitelistedToken(address l1Token) external view override returns (L1TokenRelationships memory) {
        return whitelistedTokens[l1Token];
    }

    function getOptimisticOracleLiveness() external view override returns (uint256) {
        return optimisticOracleLiveness;
    }

    function getProposerBondPct() external view override returns (uint256) {
        return proposerBondPct;
    }

    function getIdentifier() external view override returns (bytes32) {
        return identifier;
    }

    // Internal functions

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface) {
        return
            IdentifierWhitelistInterface(
                FinderInterface(finder).getImplementationAddress(OracleInterfaces.IdentifierWhitelist)
            );
    }

    function _getCollateralWhitelist() private view returns (AddressWhitelistInterface) {
        return
            AddressWhitelistInterface(
                FinderInterface(finder).getImplementationAddress(OracleInterfaces.CollateralWhitelist)
            );
    }

    function _setIdentifier(bytes32 _identifier) private {
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Identifier not registered");
        // TODO: Should we validate this _identifier? Perhaps check that its not 0x?
        identifier = _identifier;
        emit SetRelayIdentifier(identifier);
    }

    function _setOptimisticOracleLiveness(uint256 _liveness) private {
        // TODO: Validate liveness period value.
        optimisticOracleLiveness = _liveness;
        emit SetOptimisticOracleLiveness(optimisticOracleLiveness);
    }

    function _setProposerBondPct(uint256 _proposerBondPct) private {
        // TODO: Validate bond % value.
        proposerBondPct = _proposerBondPct;
        emit SetProposerBondPct(proposerBondPct);
    }
}
