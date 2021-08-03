// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// Importing local copies of OVM contracts is a temporary fix until the @eth-optimism/contracts package exports 0.8.x
// contracts. These contracts are relatively small and should have no problems porting from 0.7.x to 0.8.x, and
// changing their version is preferable to changing this contract to 0.7.x and defining compatible interfaces for all
// of the imported DVM contracts below.
import "./OVM_CrossDomainEnabled.sol";
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
contract BridgePoolFactory is Ownable, OVM_CrossDomainEnabled {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public finder;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address public depositContract;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
    }
    mapping(address => L1TokenRelationships) public whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint256 public optimisticOracleLiveness;
    uint256 public proposerBondPct;
    bytes32 public identifier;

    event SetDepositContract(address indexed l2DepositContract);
    event SetRelayIdentifier(bytes32 indexed identifier);
    event SetOptimisticOracleLiveness(uint256 indexed liveness);
    event SetProposerBondPct(uint256 indexed proposerBondPct);
    event WhitelistToken(address indexed l1Token, address indexed l2Token, address indexed bridgePool);

    // Add this modifier to methods that are expected to bridge admin functionality to the L2 Deposit contract, which
    // will cause unexpected behavior if the deposit contract isn't set and valid.
    modifier depositContractSet() {
        _validateDepositContract(depositContract);
        _;
    }

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
    function setOptimisticOracleLiveness(uint256 _liveness) public onlyOwner {
        _setOptimisticOracleLiveness(_liveness);
    }

    /**
     * @notice Sets challenge pereiod for relayed deposits. BridgePools will read this value from this
     * contract.
     * @dev Can only be called by the current owner.
     * @param _proposerBondPct New OptimisticOracle proposer bond % to set for relay price requests. 1e18 = 100%.
     */
    function setProposerBondPct(uint256 _proposerBondPct) public onlyOwner {
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
    ) public onlyOwner depositContractSet {
        require(_getCollateralWhitelist().isOnWhitelist(address(_l1Token)), "Payment token not whitelisted");

        L1TokenRelationships storage whitelistedToken = whitelistedTokens[_l1Token];
        whitelistedToken.l2Token = _l2Token;
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("whitelistToken(address,address)", _l1Token, _l2Token)
        );

        // TODO: This contract should deploy a new BridgePool if the address is set to 0x0 at this point.
        whitelistedToken.bridgePool = _bridgePool;

        emit WhitelistToken(_l1Token, _l2Token, _bridgePool);
    }

    function pauseL2Deposits() public onlyOwner {}

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

    function _validateDepositContract(address _depositContract) private {
        require(_depositContract != address(0), "Invalid deposit contract");
    }
}
