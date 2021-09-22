// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces//BridgePoolInterface.sol";
import "../interfaces/BridgeAdminInterface.sol";
import "../../../contracts/oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/interfaces/AddressWhitelistInterface.sol";
import "../../../contracts/common/implementation/Lockable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @notice Shared administrative logic among L1 BridgeAdmin contracts that have implicit references to L2 DepositBoxes.
 * This contract is responsible for making global variables accessible to BridgePool contracts, which house passive
 * liquidity and enable relaying of L2 deposits.
 */
contract BridgeAdminBase is BridgeAdminInterface, Ownable, Lockable {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public override finder;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address public override depositContract;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    mapping(address => L1TokenRelationships) internal _whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint64 public override optimisticOracleLiveness;
    uint64 public override proposerBondPct;
    bytes32 public override identifier;

    // Add this modifier to methods that are expected to bridge admin functionality to the L2 Deposit contract, which
    // will cause unexpected behavior if the deposit contract isn't set and valid.
    modifier depositContractSet() {
        _validateDepositContract(depositContract);
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
     *        VIEW FUNCTIONS             *
     **************************************/
    function whitelistedTokens(address l1Token) external view override returns (L1TokenRelationships memory) {
        return _whitelistedTokens[l1Token];
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

    /**************************************
     *        INTERNAL FUNCTIONS          *
     **************************************/

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return
            IdentifierWhitelistInterface(
                FinderInterface(finder).getImplementationAddress(OracleInterfaces.IdentifierWhitelist)
            );
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return
            AddressWhitelistInterface(
                FinderInterface(finder).getImplementationAddress(OracleInterfaces.CollateralWhitelist)
            );
    }

    function _setIdentifier(bytes32 _identifier) internal {
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Identifier not registered");
        identifier = _identifier;
        emit SetRelayIdentifier(identifier);
    }

    function _setOptimisticOracleLiveness(uint64 _liveness) internal {
        // The following constraints are copied from a similar function in the OptimisticOracle contract:
        // - https://github.com/UMAprotocol/protocol/blob/dd211c4e3825fe007d1161025a34e9901b26031a/packages/core/contracts/oracle/implementation/OptimisticOracle.sol#L621
        require(_liveness < 5200 weeks, "Liveness too large");
        require(_liveness > 0, "Liveness cannot be 0");
        optimisticOracleLiveness = _liveness;
        emit SetOptimisticOracleLiveness(optimisticOracleLiveness);
    }

    function _setProposerBondPct(uint64 _proposerBondPct) internal {
        proposerBondPct = _proposerBondPct;
        emit SetProposerBondPct(proposerBondPct);
    }

    function _validateDepositContract(address _depositContract) internal {
        require(_depositContract != address(0), "Invalid deposit contract");
    }
}
