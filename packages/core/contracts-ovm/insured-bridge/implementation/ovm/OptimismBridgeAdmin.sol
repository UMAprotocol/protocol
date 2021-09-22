// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

// Importing local copies of OVM contracts is a temporary fix until the @eth-optimism/contracts package exports 0.8.x
// contracts. These contracts are relatively small and should have no problems porting from 0.7.x to 0.8.x, and
// changing their version is preferable to changing this contract to 0.7.x and defining compatible interfaces for all
// of the imported DVM contracts below.
import "../../external/OVM_CrossDomainEnabled.sol";
import "../BridgeAdminBase.sol";

/**
 * @notice Implementation of BridgeAdminBase that can call permissioned functions on the L2 DepositBox deployed to the
 * OVM ("Optimism Virtual Machine")
 */
contract OptimismBridgeAdmin is BridgeAdminBase, OVM_CrossDomainEnabled {
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
    )
        OVM_CrossDomainEnabled(_crossDomainMessenger)
        BridgeAdminBase(_finder, _optimisticOracleLiveness, _proposerBondPct, _identifier)
    {}

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

        _whitelistedTokens[_l1Token] = L1TokenRelationships({ l2Token: _l2Token, bridgePool: _bridgePool });

        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("whitelistToken(address,address,address)", _l1Token, _l2Token, _bridgePool)
        );

        emit WhitelistToken(_l1Token, _l2Token, _bridgePool);
    }
}
