// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// Importing local copies of OVM contracts is a temporary fix until the @eth-optimism/contracts package exports 0.8.x
// contracts. These contracts are relatively small and should have no problems porting from 0.7.x to 0.8.x, and
// changing their version is preferable to changing this contract to 0.7.x and defining compatible interfaces for all
// of the imported DVM contracts below.
import "../external/OVM_CrossDomainEnabled.sol";
import "../interfaces//BridgePoolInterface.sol";
import "../interfaces/BridgeAdminInterface.sol";
import "../../../contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/interfaces/AddressWhitelistInterface.sol";
import "../../../contracts/common/implementation/Lockable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Administrative contract deployed on L1 that has an implicit reference to a DepositBox. This contract is
 * responsible for making global variables accessible to BridgePool contracts, which house passive liquidity and
 * enable relaying of L2 deposits.
 * @dev The owner of this contract can also call permissioned functions on the L2 DepositBox.
 */
contract BridgeAdmin is BridgeAdminInterface, Ownable, OVM_CrossDomainEnabled, Lockable {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public override finder;

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
    event DepositsEnabled(address indexed l2Token, bool depositsEnabled);

    // Add this modifier to methods that are expected to bridge admin functionality to the L2 Deposit contract, which
    // will cause unexpected behavior if the deposit contract isn't set and valid.
    modifier depositContractSet() {
        _validateDepositContract(depositContract);
        _;
    }

    /**
     * @notice Construct the Bridge Admin
     * @param _finder DVM finder to find other UMA ecosystem contracts.
     * @param _crossDomainMessenger Optimism messenger contract used to send messages to L2.
     * @param _optimisticOracleLiveness Timeout that all bridging actions from L2->L1 must wait for a OptimisticOracle response.
     * @param _proposerBondPct Percentage of the bridged amount that a relayer must put up as a bond.
     * @param _identifier Identifier used when querying the OO for a cross bridge transfer action.
     */
    constructor(
        address _finder,
        address _crossDomainMessenger,
        uint64 _optimisticOracleLiveness,
        uint64 _proposerBondPct,
        bytes32 _identifier
    ) OVM_CrossDomainEnabled(_crossDomainMessenger) {
        finder = _finder;
        require(address(_getCollateralWhitelist()) != address(0), "Invalid finder");
        _setOptimisticOracleLiveness(_optimisticOracleLiveness);
        _setProposerBondPct(_proposerBondPct);
        _setIdentifier(_identifier);
    }

    /**************************************
     *        ADMIN FUNCTIONS             *
     **************************************/

    /**
     * @notice Sets a price identifier to use for relayed deposits. BridgePools reads the identifier from this contract.
     * @dev Can only be called by the current owner.
     * @param _identifier New identifier to set.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner nonReentrant() {
        _setIdentifier(_identifier);
    }

    /**
     * @notice Sets challenge period for relayed deposits. BridgePools will read this value from this contract.
     * @dev Can only be called by the current owner.
     * @param _liveness New OptimisticOracle liveness period to set for relay price requests.
     */
    function setOptimisticOracleLiveness(uint64 _liveness) public onlyOwner nonReentrant() {
        _setOptimisticOracleLiveness(_liveness);
    }

    /**
     * @notice Sets challenge period for relayed deposits. BridgePools will read this value from this contract.
     * @dev Can only be called by the current owner.
     * @param _proposerBondPct New OptimisticOracle proposer bond % to set for relay price requests. 1e18 = 100%.
     */
    function setProposerBondPct(uint64 _proposerBondPct) public onlyOwner nonReentrant() {
        _setProposerBondPct(_proposerBondPct);
    }

    /**
     * @notice Sets the L2 deposit contract that originates deposit orders to be fulfilled by this bridgePool contracts.
     * @dev Only callable by the current owner.
     * @param _depositContract Address of L2 deposit contract.
     */
    function setDepositContract(address _depositContract) public onlyOwner nonReentrant() {
        _validateDepositContract(_depositContract);
        depositContract = _depositContract;
        emit SetDepositContract(depositContract);
    }

    /**************************************************
     *        CROSSDOMAIN ADMIN FUNCTIONS             *
     **************************************************/

    /**
     * @notice Set new contract as the admin address in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param _admin New admin address to set on L2.
     * @param _l2Gas Gas limit to set for relayed message on L2.
     */
    function setBridgeAdmin(address _admin, uint32 _l2Gas) public onlyOwner depositContractSet nonReentrant() {
        require(_admin != address(0), "Admin cannot be zero address");
        sendCrossDomainMessage(depositContract, _l2Gas, abi.encodeWithSignature("setBridgeAdmin(address)", _admin));
        emit SetBridgeAdmin(_admin);
    }

    /**
     * @notice Sets the minimum time between L2-->L1 token withdrawals in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param _minimumBridgingDelay the new minimum delay.
     * @param _l2Gas Gas limit to set for relayed message on L2.
     */
    function setMinimumBridgingDelay(uint64 _minimumBridgingDelay, uint32 _l2Gas)
        public
        onlyOwner
        depositContractSet
        nonReentrant()
    {
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("setMinimumBridgingDelay(uint64)", _minimumBridgingDelay)
        );
        emit SetMinimumBridgingDelay(_minimumBridgingDelay);
    }

    /**
     * @notice Owner can pause/unpause L2 deposits for a tokens.
     * @dev Only callable by Owner of this contract. Will set the same setting in the L2 Deposit contract via the cross
     * domain messenger.
     * @param _l2Token address of L2 token to enable/disable deposits for.
     * @param _depositsEnabled bool to set if the deposit box should accept/reject deposits.
     * @param _l2Gas Gas limit to set for relayed message on L2.
     */
    function setEnableDeposits(
        address _l2Token,
        bool _depositsEnabled,
        uint32 _l2Gas
    ) public onlyOwner depositContractSet nonReentrant() {
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("setEnableDeposits(address,bool)", _l2Token, _depositsEnabled)
        );
        emit DepositsEnabled(_l2Token, _depositsEnabled);
    }

    /**
     * @notice Privileged account can associate a whitelisted token with its linked token address on L2. The linked L2
     * token can thereafter be deposited into the Deposit contract on L2 and relayed via the BridgePool contract.
     * @dev Only callable by Owner of this contract. Also initiates a cross-chain call to the L2 Deposit contract to
     * whitelist the token mapping.
     * @param _l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param _l2Token Address of L2 token whose deposits are fulfilled by `_l1Token`.
     * @param _bridgePool Address of BridgePool which manages liquidity to fulfill L2-->L1 relays.
     * @param _l2Gas Gas limit to set for relayed message on L2
     */
    function whitelistToken(
        address _l1Token,
        address _l2Token,
        address _bridgePool,
        uint32 _l2Gas
    ) public onlyOwner depositContractSet nonReentrant() {
        require(_bridgePool != address(0), "BridgePool cannot be zero address");
        require(_l2Token != address(0), "L2 token cannot be zero address");
        require(_getCollateralWhitelist().isOnWhitelist(address(_l1Token)), "Payment token not whitelisted");

        require(address(BridgePoolInterface(_bridgePool).l1Token()) == _l1Token, "Bridge pool has different L1 token");

        whitelistedTokens[_l1Token] = L1TokenRelationships({ l2Token: _l2Token, bridgePool: _bridgePool });

        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("whitelistToken(address,address,address)", _l1Token, _l2Token, _bridgePool)
        );

        emit WhitelistToken(_l1Token, _l2Token, _bridgePool);
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
        // The following constraints are copied from a similar function in the OptimisticOracle contract:
        // - https://github.com/UMAprotocol/protocol/blob/dd211c4e3825fe007d1161025a34e9901b26031a/packages/core/contracts/oracle/implementation/OptimisticOracle.sol#L621
        require(_liveness < 5200 weeks, "Liveness too large");
        require(_liveness > 0, "Liveness cannot be 0");
        optimisticOracleLiveness = _liveness;
        emit SetOptimisticOracleLiveness(optimisticOracleLiveness);
    }

    function _setProposerBondPct(uint64 _proposerBondPct) private {
        proposerBondPct = _proposerBondPct;
        emit SetProposerBondPct(proposerBondPct);
    }

    function _validateDepositContract(address _depositContract) private {
        require(_depositContract != address(0), "Invalid deposit contract");
    }
}
