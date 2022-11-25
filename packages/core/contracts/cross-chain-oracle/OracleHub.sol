// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./OracleBase.sol";
import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/StoreInterface.sol";
import "../common/implementation/Lockable.sol";
import "../common/implementation/MultiCaller.sol";
import "./interfaces/ParentMessengerInterface.sol";
import "./interfaces/ParentMessengerConsumerInterface.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Cross-chain Oracle L1 Oracle Hub.
 * @notice Gatekeeper contract deployed on mainnet that validates and sends price requests from sidechain to the DVM on
 * mainnet. This is a "gate keeper" contract because it performs the final validation for any messages originating from
 * a child chain's oracle before submitting price requests to the DVM. This contract also can publish DVM price
 * resolution data to OracleSpokes on any chainId via the messenger for that chainId.
 * @dev This contract must be a registered financial contract in order to make and query DVM price requests.
 */

contract OracleHub is OracleBase, ParentMessengerConsumerInterface, Ownable, Lockable, MultiCaller {
    using SafeERC20 for IERC20;

    // Currency that final fees are paid in.
    IERC20 public token;

    // Associates chain ID with ParentMessenger contract to use to send price resolutions to that chain's OracleSpoke
    // contract via its ChildMessenger contract.
    mapping(uint256 => ParentMessengerInterface) public messengers;

    event SetParentMessenger(uint256 indexed chainId, address indexed parentMessenger);

    constructor(address _finderAddress, IERC20 _token) HasFinder(_finderAddress) {
        token = _token;
    }

    modifier onlyMessenger(uint256 chainId) {
        require(msg.sender == address(messengers[chainId]), "Caller must be messenger for network");
        _;
    }

    /**
     * @notice Set new ParentMessenger contract for chainId.
     * @param chainId network that has a child messenger contract that parent messenger contract will communicate with.
     * @param messenger ParentMessenger contract that sends messages to ChildMessenger on network with ID `chainId`.
     * @dev Only callable by the owner (presumably the Ethereum Governor contract).
     */
    function setMessenger(uint256 chainId, ParentMessengerInterface messenger) public nonReentrant() onlyOwner {
        messengers[chainId] = messenger;
        emit SetParentMessenger(chainId, address(messenger));
    }

    /**
     * @notice Publishes a DVM resolved price to the OracleSpoke deployed on the network linked  with `chainId`, or
     * reverts if not resolved yet. This contract must be registered with the DVM to query price requests.
     * The DVM price resolution is communicated to the OracleSpoke via the Parent-->Child messenger channel.
     * @dev This method will always attempt to call `messenger.sendMessageToChild` even if it is a duplicate call for
     * this price request. Therefore the Messenger contract for this `chainId` should determine how to handle duplicate
     * calls.
     * @dev This method is `payable` so that ETH can be forwarded to Messenger contracts that need to send ETH
     * from L1 to L2, like Arbitrum messengers for example. For networks that do not use ETH, the caller will
     * lose ETH, therefore it is the caller's responsibility to know when to send ETH. This is allowed to be
     * `payable` because any EOA can call this function.
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
    ) public payable nonReentrant() {
        // `getPrice` will revert if there is no price.
        int256 price = _getOracle().getPrice(identifier, time, ancillaryData);
        _publishPrice(identifier, time, ancillaryData, price);

        // Require caller to include enough ETH to pass to Messenger so that caller cannot take advantage of excess
        // ETH held by the Messenger. Caller can easily query messenger to get exact amount of ETh to send.
        uint256 requiredL1CallValue = messengers[chainId].getL1CallValue();
        require(msg.value == requiredL1CallValue, "Insufficient msg.value");

        // Call returns a boolean value indicating success or failure.
        // This is the current recommended method to use: https://solidity-by-example.org/sending-ether/
        if (msg.value > 0) {
            (bool sent, ) = address(messengers[chainId]).call{ value: msg.value }("");
            require(sent, "Cannot send ETH to messenger");
        }

        // Pass all msg.value to Messenger:
        messengers[chainId].sendMessageToChild(abi.encode(identifier, time, ancillaryData, price));
    }

    /**
     * @notice Submits a price request originating from an OracleSpoke. Request data must be sent via the
     * Child --> Parent Messenger communication channel. Returns silently if price request is a duplicate.
     * @dev This contract must be registered to submit price requests to the DVM. Only the ParentMessenger
     * can call this method. If the original requester on the child chain wants to expedite the Child --> Parent
     * message, then they can call `requestPrice` on this contract for the same unique price request.
     * @param chainId id of the child chain that sent the price request.
     * @param data ABI encoded params with which to call `_requestPrice`.
     */
    function processMessageFromChild(uint256 chainId, bytes memory data)
        public
        override
        nonReentrant()
        onlyMessenger(chainId)
    {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData) = abi.decode(data, (bytes32, uint256, bytes));
        bool newPriceRequested = _requestPrice(identifier, time, ancillaryData);
        if (newPriceRequested) {
            _getOracle().requestPrice(identifier, time, ancillaryData);
        }
    }

    /**
     * @notice Anyone can call this method to directly request a price to the DVM. This could be used by the child
     * chain requester in the case where Child --> Parent communication takes too long and the requester wants to speed
     * up the price resolution process. Returns silently if price request is a duplicate. Calling this method from
     * the user's point of view is no different than calling the OptimisticOracle.requestPrice method, but with a
     * different interface.
     * @dev The caller must pay a final fee and have approved this contract to pull final fee from it.
     * @dev If the price request params including the ancillary data does not match exactly the price request submitted
     * on the child chain, then the child chain's price request will not resolve. The caller is recommended to use the
     * `stampAncillaryData` method on the OracleSpoke to reconstruct the ancillary data.
     * @param identifier Identifier for price request.
     * @param time time for price request.
     * @param ancillaryData Extra data for price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public nonReentrant() {
        bool newPriceRequested = _requestPrice(identifier, time, ancillaryData);
        if (newPriceRequested) {
            uint256 finalFee = _getStore().computeFinalFee(address(token)).rawValue;
            token.safeTransferFrom(msg.sender, address(_getStore()), finalFee);
            _getOracle().requestPrice(identifier, time, ancillaryData);
        }
    }

    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }
}
