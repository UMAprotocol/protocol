// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseRootTunnel.sol";

import "./OracleBaseTunnel.sol";
import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../common/implementation/Lockable.sol";

/**
 * @title Adapter deployed on mainnet that validates and sends price requests from sidechain to the DVM on mainnet.
 * @dev This contract must be a registered financial contract in order to make DVM price requests.
 */
contract OracleRootTunnel is OracleBaseTunnel, FxBaseRootTunnel, Lockable {
    constructor(
        address _checkpointManager,
        address _fxRoot,
        address _finderAddress
    ) OracleBaseTunnel(_finderAddress) FxBaseRootTunnel(_checkpointManager, _fxRoot) {}

    /**
     * @notice This is the first method that should be called in order to publish a price request to the sidechain.
     * @dev Publishes the DVM resolved price for the price request, or reverts if not resolved yet. This contract must
     * be registered with the DVM to query price requests.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData extra data of price request to resolve.
     */
    function publishPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public nonReentrant() {
        // `getPrice` will revert if there is no price.
        int256 price = _getOracle().getPrice(identifier, time, ancillaryData);
        // This implementation allows duplicate MessageSent events via _sendMessageToRoot. The child tunnel on the
        // sidechain will not have a problem handling duplicate price resolutions (it will just ignore them). This is
        // potentially a fallback in case the automatic state sync to the sidechain is missing the `publishPrice`
        // transaction for some reason. There is little risk in duplicating MessageSent emissions because the sidechain
        // bridge does not impose any rate-limiting.
        _publishPrice(identifier, time, ancillaryData, price);
        _sendMessageToChild(abi.encode(identifier, time, ancillaryData, price));
    }

    /**
     * @notice Submits a price request.
     * @dev This internal method will be called inside `receiveMessage(bytes memory inputData)`. The `inputData` is a
     * proof of transaction that is derived from the transaction hash of the transaction on the child chain that
     * originated the cross-chain price request via _sendMessageToRoot. This contract must be registered with the DVM
     * to submit price requests.
     * @param data ABI encoded params with which to call `requestPrice`.
     */
    function _processMessageFromChild(bytes memory data) internal override {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData) = abi.decode(data, (bytes32, uint256, bytes));
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    /**
     * @notice Return DVM for this network.
     */
    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
