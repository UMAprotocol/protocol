// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../oracle/interfaces/RegistryInterface.sol";
import "./OracleBase.sol";
import "../common/implementation/AncillaryData.sol";
import "../common/implementation/Lockable.sol";
import "./ChildMessengerInterface.sol";

/**
 * @title Adapter deployed on child chain to give financial contracts the ability to trigger cross-chain price requests
 * to the mainnet DVM. Also has the ability to receive published prices from mainnet. This contract can be treated as
 * the "DVM" for this network, because a calling contract can request and access a resolved price request from this
 * contract.
 * @dev The intended client of this contract is an OptimisticOracle on sidechain that needs price
 * resolution secured by the DVM on mainnet.
 */
contract OracleSpoke is OracleBase, OracleAncillaryInterface, Lockable {
    ChildMessengerInterface public messenger;

    constructor(address _finderAddress, address _messengerAddress) OracleBase(_finderAddress) {
        messenger = ChildMessengerInterface(_messengerAddress);
    }

    // This assumes that the local network has a Registry that resembles the mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    modifier onlyMessenger() {
        require(msg.sender == address(messenger), "Caller must be messenger");
        _;
    }

    /**
     * @notice This should be called to bridge a price request to mainnet. This method will enqueue a new price request
     * or return silently if already requested or return silently if price request is a duplicate.
     * @dev Can be called only by a registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the price resolution data from mainnet.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override nonReentrant() onlyRegisteredContract() {
        bool newPriceRequested = _requestPrice(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
        if (newPriceRequested) {
            messenger.sendMessageToRoot(abi.encode(identifier, time, _stampAncillaryData(ancillaryData, msg.sender)));
        }
    }

    /**
     * @notice Resolves a price request originating from root. Request data must be sent via the Messenger contract.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function processMessageFromRoot(bytes memory data) public nonReentrant() onlyMessenger() {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData, int256 price) =
            abi.decode(data, (bytes32, uint256, bytes, int256));
        _publishPrice(identifier, time, ancillaryData, price);
    }

    /**
     * @notice Returns whether a price has resolved for the request.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request
     * @param ancillaryData extra data of price request.
     * @return True if a price is available, False otherwise. If true, then getPrice will succeed for the request.
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override nonReentrantView() onlyRegisteredContract() returns (bool) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
        return prices[priceRequestId].state == RequestState.Resolved;
    }

    /**
     * @notice Returns resolved price for the request.
     * @dev Reverts if price is not available.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request
     * @param ancillaryData extra data of price request.
     * @return int256 Price, or reverts if no resolved price for any reason.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override nonReentrantView() onlyRegisteredContract() returns (int256) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData, msg.sender));
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price request.
     * @param ancillaryData ancillary data of the price being requested.
     * @param requester sender of the initial price request.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory ancillaryData, address requester)
        public
        view
        nonReentrantView()
        returns (bytes memory)
    {
        return _stampAncillaryData(ancillaryData, requester);
    }

    /**
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translatable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translatable part of the
     * ancillary data that this contract stamps.
     */
    function _stampAncillaryData(bytes memory ancillaryData, address requester) internal view returns (bytes memory) {
        // This contract should stamp its requester's address and network in the
        // ancillary data so voters can conveniently track the requests path to the DVM.
        return
            AncillaryData.appendKeyValueUint(
                AncillaryData.appendKeyValueAddress(ancillaryData, "childRequester", requester),
                "childChainId",
                block.chainid
            );
    }
}
