// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./OracleBase.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../common/implementation/Lockable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./RootMessengerInterface.sol";

/**
 * @title Gatekeeper contract deployed on mainnet that validates and sends price requests from sidechain to the DVM on
 * mainnet. This is a "gate keeper" contract because it performs the final validation for any messages originating from
 * a child chain's oracle before submitting price requests to the DVM. This contract also can publish DVM price
 * resolution data to OracleSpokes on any chainId via the messenger for that chainId.
 * @dev This contract must be a registered financial contract in order to make and query DVM price requests.
 */
contract OracleHub is OracleBase, Ownable, Lockable {
    // Associates chain ID with RootMessenger contract to use to send price resolutions to that chain's OracleSpoke
    // contract.
    mapping(uint256 => RootMessengerInterface) public messengers;

    constructor(address _finderAddress) OracleBase(_finderAddress) {}

    modifier onlyMessenger(uint256 chainId) {
        require(msg.sender == address(messengers[chainId]), "Caller must be messenger for network");
        _;
    }

    /**
     * @notice Set new Messenger contract for chainId.
     * @param chainId network that messenger contract will communicate with
     * @param messenger RootMessenger contract that sends messages to network with ID `chainId`
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function setMessenger(uint256 chainId, address messenger) public nonReentrant() onlyOwner {
        require(messenger != address(0), "Invalid messenger contract");
        messengers[chainId] = RootMessengerInterface(messenger);
    }

    /**
     * @notice Publishes the DVM resolved price for the price request on the OracleSpoke deployed on the network linked
     * with `chainId`, or reverts if not resolved yet. This contract must be registered with the DVM to query price
     * requests.
     * @dev This method will return silently if already called for this price request, but will attempt to call
     * `messenger.sendMessageToChild` again even if it is a duplicate call. Therefore the Messenger contract for this
     * `chainId` should determine how to handle duplicate calls.
     * @param chainId Network to resolve price for.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData extra data of price request to resolve.
     */
    function publishPrice(
        uint256 chainId,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public nonReentrant() {
        // `getPrice` will revert if there is no price.
        int256 price = _getOracle().getPrice(identifier, time, ancillaryData);
        _publishPrice(identifier, time, ancillaryData, price);
        messengers[chainId].sendMessageToChild(abi.encode(identifier, time, ancillaryData, price));
    }

    /**
     * @notice Submits a price request originating from any child OracleSpoke. Request data must be sent via the
     * Messenger contract. Returns silently if price request is a duplicate.
     * @dev This contract must be registered to submit price requests to the DVM.
     * @param data ABI encoded params with which to call `_requestPrice`.
     */
    function processMessageFromChild(uint256 chainid, bytes memory data) public nonReentrant() onlyMessenger(chainid) {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData) = abi.decode(data, (bytes32, uint256, bytes));
        bool newPriceRequested = _requestPrice(identifier, time, ancillaryData);
        if (newPriceRequested) {
            _getOracle().requestPrice(identifier, time, ancillaryData);
        }
    }

    /**
     * @notice Return DVM for this network.
     */
    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
