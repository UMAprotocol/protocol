// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseRootTunnel.sol";
import "../common/implementation/Lockable.sol";

/**
 * @title Governance relayer contract to be deployed on Ethereum that receives messages from the owner (Governor) and
 * sends them to sidechain.
 */
contract GovernorRootTunnel is Ownable, FxBaseRootTunnel, Lockable {
    event RelayedGovernanceRequest(address indexed to, bytes data);

    constructor(address _checkpointManager, address _fxRoot) FxBaseRootTunnel(_checkpointManager, _fxRoot) {}

    /**
     * @notice This should be called in order to relay a governance request to the `GovernorChildTunnel` contract
     * deployed to the sidechain. Note: this can only be called by the owner (presumably the Ethereum Governor
     * contract).
     * @dev The transaction submitted to `to` on the sidechain with the calldata `data` is assumed to have 0 `value`
     * in order to avoid the added complexity of sending cross-chain transactions with positive value.
     */
    function relayGovernance(address to, bytes memory data) external nonReentrant() onlyOwner {
        _sendMessageToChild(abi.encode(to, data));
        emit RelayedGovernanceRequest(to, data);
    }

    /**
     * @notice Function called as callback from child tunnel. Should not do anything as governance actions should only
     * be sent from root to child.
     */
    function _processMessageFromChild(bytes memory data) internal override {
        // no-op
    }
}
