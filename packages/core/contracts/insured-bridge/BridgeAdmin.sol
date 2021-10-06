// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./interfaces//BridgePoolInterface.sol";
import "./interfaces/BridgeAdminInterface.sol";
import "./interfaces/MessengerInterface.sol";
import "../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Constants.sol";
import "../common/interfaces/AddressWhitelistInterface.sol";
import "../common/implementation/Lockable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Administrative contract deployed on L1 that has implicit references to all L2 DepositBoxes. This contract is
 * responsible for making global variables accessible to BridgePool contracts, which house passive liquidity and
 * enable relaying of L2 deposits.
 * @dev The owner of this contract can also call permissioned functions on registered L2 DepositBoxes.
 */
contract BridgeAdmin is BridgeAdminInterface, Ownable, Lockable {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public override finder;

    // This contract can relay messages to any number of L2 DepositBoxes, one per L2 network, each identified by a
    // unique network ID. To relay a message, both the deposit box contract address and a messenger contract address
    // need to be stored. The messenger implementation differs for each L2 because L1 --> L2 messaging is non-standard.
    // The deposit box contract originate the deposits that can be fulfilled by BridgePool contracts on L1.
    mapping(uint256 => DepositUtilityContracts) private _depositContracts;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    mapping(address => L1TokenRelationships) private _whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint64 public override optimisticOracleLiveness;
    uint64 public override proposerBondPct;
    bytes32 public override identifier;

    // Add this modifier to methods that are expected to bridge messages to a L2 Deposit contract, which
    // will cause unexpected behavior if the deposit or messenger helper contract isn't set and valid.
    modifier canRelay(uint256 chainId) {
        _validateDepositContracts(
            _depositContracts[chainId].depositContract,
            _depositContracts[chainId].messengerContract
        );
        _;
    }

    /**
     * @notice Construct the Bridge Admin
     * @param _finder DVM finder to find other UMA ecosystem contracts.
     * @param _optimisticOracleLiveness Timeout that all bridging actions from L2->L1 must wait for a OptimisticOracle response.
     * @param _proposerBondPct Percentage of the bridged amount that a relayer must put up as a bond.
     * @param _identifier Identifier used when querying the OO for a cross bridge transfer action.
     */
    constructor(
        address _finder,
        uint64 _optimisticOracleLiveness,
        uint64 _proposerBondPct,
        bytes32 _identifier
    ) {
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
     * @notice Associates the L2 deposit and L1 messenger helper addresses with an L2 network ID.
     * @dev Only callable by the current owner.
     * @param chainId L2 network ID to set addresses for.
     * @param depositContract Address of L2 deposit contract.
     * @param messengerContract Address of L1 helper contract that relays messages to L2.
     */
    function setDepositContract(
        uint256 chainId,
        address depositContract,
        address messengerContract
    ) public onlyOwner nonReentrant() {
        _validateDepositContracts(depositContract, messengerContract);
        _depositContracts[chainId].depositContract = depositContract;
        _depositContracts[chainId].messengerContract = messengerContract;
        emit SetDepositContracts(chainId, depositContract, messengerContract);
    }

    /**************************************************
     *        CROSSDOMAIN ADMIN FUNCTIONS             *
     **************************************************/

    /**
     * @notice Set new contract as the admin address in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param chainId L2 network ID where Deposit contract is deployed.
     * @param admin New admin address to set on L2.
     * @param l2Gas Gas limit to set for relayed message on L2.
     * @param l2GasPrice Gas price bid to set for relayed message on L2.
     */
    function setBridgeAdmin(
        uint256 chainId,
        address admin,
        uint32 l2Gas,
        uint256 l2GasPrice
    ) public onlyOwner canRelay(chainId) nonReentrant() {
        require(admin != address(0), "Admin cannot be zero address");
        MessengerInterface(_depositContracts[chainId].messengerContract).relayMessage(
            _depositContracts[chainId].depositContract,
            l2Gas,
            l2GasPrice,
            abi.encodeWithSignature("setBridgeAdmin(address)", admin)
        );
        emit SetBridgeAdmin(chainId, admin);
    }

    /**
     * @notice Sets the minimum time between L2-->L1 token withdrawals in the L2 Deposit contract.
     * @dev Only callable by the current owner.
     * @param chainId L2 network ID where Deposit contract is deployed.
     * @param _minimumBridgingDelay the new minimum delay.
     * @param l2Gas Gas limit to set for relayed message on L2.
     * @param l2GasPrice Gas price bid to set for relayed message on L2.
     */
    function setMinimumBridgingDelay(
        uint256 chainId,
        uint64 _minimumBridgingDelay,
        uint32 l2Gas,
        uint256 l2GasPrice
    ) public onlyOwner canRelay(chainId) nonReentrant() {
        MessengerInterface(_depositContracts[chainId].messengerContract).relayMessage(
            _depositContracts[chainId].depositContract,
            l2Gas,
            l2GasPrice,
            abi.encodeWithSignature("setMinimumBridgingDelay(uint64)", _minimumBridgingDelay)
        );
        emit SetMinimumBridgingDelay(chainId, _minimumBridgingDelay);
    }

    /**
     * @notice Owner can pause/unpause L2 deposits for a tokens.
     * @dev Only callable by Owner of this contract. Will set the same setting in the L2 Deposit contract via the cross
     * domain messenger.
     * @param chainId L2 network ID where Deposit contract is deployed.
     * @param l2Token address of L2 token to enable/disable deposits for.
     * @param depositsEnabled bool to set if the deposit box should accept/reject deposits.
     * @param l2Gas Gas limit to set for relayed message on L2.
     * @param l2GasPrice Gas price bid to set for relayed message on L2.
     */
    function setEnableDeposits(
        uint256 chainId,
        address l2Token,
        bool depositsEnabled,
        uint32 l2Gas,
        uint256 l2GasPrice
    ) public onlyOwner canRelay(chainId) nonReentrant() {
        MessengerInterface(_depositContracts[chainId].messengerContract).relayMessage(
            _depositContracts[chainId].depositContract,
            l2Gas,
            l2GasPrice,
            abi.encodeWithSignature("setEnableDeposits(address,bool)", l2Token, depositsEnabled)
        );
        emit DepositsEnabled(chainId, l2Token, depositsEnabled);
    }

    /**
     * @notice Privileged account can associate a whitelisted token with its linked token address on L2. The linked L2
     * token can thereafter be deposited into the Deposit contract on L2 and relayed via the BridgePool contract.
     * @dev This method is also used to to update the address of the bridgePool within a BridgeDepositBox through the
     * re-whitelisting of a previously whitelisted token to update the address of the bridge pool in the deposit box.
     * @dev Only callable by Owner of this contract. Also initiates a cross-chain call to the L2 Deposit contract to
     * whitelist the token mapping.
     * @param chainId L2 network ID where Deposit contract is deployed.
     * @param l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param l2Token Address of L2 token whose deposits are fulfilled by `l1Token`.
     * @param bridgePool Address of BridgePool which manages liquidity to fulfill L2-->L1 relays.
     * @param l2Gas Gas limit to set for relayed message on L2.
     * @param l2GasPrice Gas price bid to set for relayed message on L2.
     */
    function whitelistToken(
        uint256 chainId,
        address l1Token,
        address l2Token,
        address bridgePool,
        uint32 l2Gas,
        uint256 l2GasPrice
    ) public onlyOwner canRelay(chainId) nonReentrant() {
        require(bridgePool != address(0), "BridgePool cannot be zero address");
        require(l2Token != address(0), "L2 token cannot be zero address");
        require(_getCollateralWhitelist().isOnWhitelist(address(l1Token)), "L1Token token not whitelisted");

        require(address(BridgePoolInterface(bridgePool).l1Token()) == l1Token, "Bridge pool has different L1 token");

        L1TokenRelationships storage l1TokenRelationships = _whitelistedTokens[l1Token];
        l1TokenRelationships.l2Tokens[chainId] = l2Token; // Set the L2Token at the index of the chainId.
        l1TokenRelationships.bridgePool = bridgePool;

        MessengerInterface(_depositContracts[chainId].messengerContract).relayMessage(
            _depositContracts[chainId].depositContract,
            l2Gas,
            l2GasPrice,
            abi.encodeWithSignature("whitelistToken(address,address,address)", l1Token, l2Token, bridgePool)
        );
        emit WhitelistToken(chainId, l1Token, l2Token, bridgePool);
    }

    /**************************************
     *           VIEW FUNCTIONS           *
     **************************************/
    function depositContracts(uint256 chainId) external view override returns (DepositUtilityContracts memory) {
        return _depositContracts[chainId];
    }

    function whitelistedTokens(address l1Token, uint256 chainId)
        external
        view
        override
        returns (address l2Token, address bridgePool)
    {
        return (_whitelistedTokens[l1Token].l2Tokens[chainId], _whitelistedTokens[l1Token].bridgePool);
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

    function _validateDepositContracts(address depositContract, address messengerContract) private {
        require(
            (depositContract != address(0)) && (messengerContract != address(0)),
            "Invalid deposit or messenger contract"
        );
    }
}
