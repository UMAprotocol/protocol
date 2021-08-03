// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// Importing local copies of OVM contracts is a temporary fix until the @eth-optimism/contracts package exports 0.8.x
// contracts. These contracts are relatively small and should have no problems porting from 0.7.x to 0.8.x, and
// changing their version is preferable to changing this contract to 0.7.x and defining compatible interfaces for all
// of the imported DVM contracts below.
import "./OVM_CrossDomainEnabled.sol";
import "./BridgePoolFactoryInterface.sol";
import "./BridgePool.sol";
import "../../../contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/interfaces/AddressWhitelistInterface.sol";
import "../../../contracts/common/implementation/Testable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Administrative contract deployed on L1 that has an implicit reference to a DepositBox. This contract is
 * responsible for deploying new BridgePools, which houses passive liquidity and enables relaying of L2 deposits.
 * @dev The owner of this contract can call permissioned functions on the L2 DepositBox.
 */
contract BridgePoolFactory is BridgePoolFactoryInterface, Ownable, Testable, OVM_CrossDomainEnabled {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public override finder;

    address public timer;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address public override depositContract;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    mapping(address => L1TokenRelationships) public whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint64 public override optimisticOracleLiveness;
    uint64 public override proposerBondPct;
    bytes32 public override identifier;

    event SetDepositContract(address indexed l2DepositContract);
    event SetBridgeAdmin(address indexed bridgeAdmin);
    event SetRelayIdentifier(bytes32 indexed identifier);
    event SetOptimisticOracleLiveness(uint64 indexed liveness);
    event SetProposerBondPct(uint64 indexed proposerBondPct);
    event WhitelistToken(address indexed l1Token, address indexed l2Token, address indexed bridgePool);
    event DeployedBridgePool(address indexed bridgePool);
    event SetMinimumBridgingDelay(uint64 newMinimumBridgingDelay);
    event DepositsEnabled(bool depositsEnabled);

    // Add this modifier to methods that are expected to bridge admin functionality to the L2 Deposit contract, which
    // will cause unexpected behavior if the deposit contract isn't set and valid.
    modifier depositContractSet() {
        _validateDepositContract(depositContract);
        _;
    }

    // TODO: Switch to hardcoded OVM_L1CrossDomainMessenger: https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts/deployments/README.md
    constructor(
        address _finder,
        address _crossDomainMessenger,
        uint64 _optimisticOracleLiveness,
        uint64 _proposerBondPct,
        bytes32 _identifier,
        address _timer
    ) OVM_CrossDomainEnabled(_crossDomainMessenger) Testable(_timer) {
        finder = _finder;
        timer = _timer;
        require(address(_getCollateralWhitelist()) != address(0), "Invalid finder");
        _setOptimisticOracleLiveness(_optimisticOracleLiveness);
        _setProposerBondPct(_proposerBondPct);
        _setIdentifier(_identifier);
    }

    /**************************************
     *        ADMIN FUNCTIONS             *
     **************************************/

    /**
     * @notice Sets new price identifier to use for relayed deposits. BridgePools will read the identifier from this
     * contract.
     * @dev Can only be called by the current owner.
     * @param _identifier New identifier to set.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        _setIdentifier(_identifier);
    }

    /**
     * @notice Sets challenge period for relayed deposits. BridgePools will read this value from this
     * contract.
     * @dev Can only be called by the current owner.
     * @param _liveness New OptimisticOracle liveness period to set for relay price requests.
     */
    function setOptimisticOracleLiveness(uint64 _liveness) public onlyOwner {
        _setOptimisticOracleLiveness(_liveness);
    }

    /**
     * @notice Sets challenge pereiod for relayed deposits. BridgePools will read this value from this
     * contract.
     * @dev Can only be called by the current owner.
     * @param _proposerBondPct New OptimisticOracle proposer bond % to set for relay price requests. 1e18 = 100%.
     */
    function setProposerBondPct(uint64 _proposerBondPct) public onlyOwner {
        _setProposerBondPct(_proposerBondPct);
    }

    /**
     * @notice Privileged account can set L2 deposit contract that originates deposit orders to be fulfilled by this
     * contract.
     * @dev Only callable by the current owner.
     * @param _depositContract Address of L2 deposit contract.
     */
    function setDepositContract(address _depositContract) public onlyOwner {
        _validateDepositContract(_depositContract);
        depositContract = _depositContract;
        emit SetDepositContract(depositContract);
    }

    /**************************************************
     *        CROSSDOMAIN ADMIN FUNCTIONS             *
     **************************************************/

    /**
     * @notice Set this contract as the admin address in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function setBridgeAdmin(uint32 _l2Gas) public onlyOwner depositContractSet {
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("setBridgeAdmin(address)", address(this))
        );
        emit SetBridgeAdmin(address(this));
    }

    /**
     * @notice Sets the minimum time between L2-->L1 token withdrawals in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param _minimumBridgingDelay the new minimum delay.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function setMinimumBridgingDelay(uint64 _minimumBridgingDelay, uint32 _l2Gas) public onlyOwner depositContractSet {
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("setMinimumBridgingDelay(uint64)", _minimumBridgingDelay)
        );
        emit SetMinimumBridgingDelay(_minimumBridgingDelay);
    }

    /**
     * @notice Owner can pause/unpause L2 deposits for all tokens.
     * @dev Only callable by the current owner. Will set the same setting in the L2 Deposit contract via the cross
     * domain messenger.
     * @param _depositsEnabled bool to set if the deposit box should accept/reject deposits.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function setEnableDeposits(bool _depositsEnabled, uint32 _l2Gas) public onlyOwner depositContractSet {
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("setEnableDeposits(bool)", _depositsEnabled)
        );
        emit DepositsEnabled(_depositsEnabled);
    }

    /**
     * @notice Privileged account can associate a whitelisted token with its linked token address on L2. The linked L2
     * token can thereafter be deposited into the Deposit contract on L2 and relayed via the BridgePool contract.
     * @dev This will also deploy a new BridgePool if there is no such contract associated with the L1 token.
     * @dev Only callable by Owner of this contract. Also initiates a cross-chain call to the L2 Deposit contract to
     * whitelist the token mapping.
     * @param _l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param _l2Token Address of L2 token whose deposits are fulfilled by `_l1Token`.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function whitelistToken(
        address _l1Token,
        address _l2Token,
        uint32 _l2Gas
    ) public onlyOwner depositContractSet {
        require(_getCollateralWhitelist().isOnWhitelist(address(_l1Token)), "Payment token not whitelisted");

        L1TokenRelationships storage whitelistedToken = whitelistedTokens[_l1Token];
        whitelistedToken.l2Token = _l2Token;
        // If token mapping isn't associated with a BridgePool, then deploy a new one. Otherwise just update the mapping.
        if (whitelistedToken.bridgePool == address(0)) {
            BridgePool newPool = new BridgePool(address(this), timer);
            whitelistedToken.bridgePool = address(newPool);
            emit DeployedBridgePool(address(newPool));
        }

        // TODO: Need to prepare for situation where this async transaction fails due to insufficient gas, or other
        // reasons. Currently, the user can execute this function again.
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature(
                "whitelistToken(address,address,address)",
                _l1Token,
                _l2Token,
                whitelistedToken.bridgePool
            )
        );

        emit WhitelistToken(_l1Token, _l2Token, whitelistedToken.bridgePool);
    }

    /**************************************
     *        INTERNAL FUNCTIONS          *
     **************************************/

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
        identifier = _identifier;
        emit SetRelayIdentifier(identifier);
    }

    function _setOptimisticOracleLiveness(uint64 _liveness) private {
        // TODO: Validate liveness period value.
        optimisticOracleLiveness = _liveness;
        emit SetOptimisticOracleLiveness(optimisticOracleLiveness);
    }

    function _setProposerBondPct(uint64 _proposerBondPct) private {
        // TODO: Validate bond % value.
        proposerBondPct = _proposerBondPct;
        emit SetProposerBondPct(proposerBondPct);
    }

    function _validateDepositContract(address _depositContract) private {
        require(_depositContract != address(0), "Invalid deposit contract");
    }
}
