// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../oracle/interfaces/OracleInterface.sol";
import "../oracle/interfaces/RegistryInterface.sol";
import "./OracleBase.sol";
import "../common/implementation/AncillaryData.sol";
import "../common/implementation/Lockable.sol";
import "./ChildMessengerInterface.sol";

/**
 * @title This contract is primarily intended to receive messages on the child chain from a parent chain and allow
 * contracts deployed on the child chain to interact with this contract as an Oracle. Moreover, this contract gives
 * child chain contracts the ability to trigger cross-chain price requests to the mainnet DVM. This Spoke knows how
 * to communicate with the parent chain via a "ChildMessenger" contract which directly communicates with the
 * "ParentMessenger" on mainnet.
 * @dev The intended client of this contract is an OptimisticOracle on sidechain that needs price
 * resolution secured by the DVM on mainnet.
 */
contract OracleSpoke is OracleBase, OracleAncillaryInterface, OracleInterface, Lockable {
    ChildMessengerInterface public messenger;

    event SetChildMessenger(address indexed childMessenger);

    constructor(address _finderAddress, ChildMessengerInterface _messengerAddress) OracleBase(_finderAddress) {
        messenger = _messengerAddress;
        emit SetChildMessenger(address(messenger));
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
     * @notice This is called to bridge a price request to mainnet. This method will enqueue a new price request
     * or return silently if already requested. Price requests are relayed to mainnet (the "Parent" chain) via
     * the ChildMessenger contract.
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
            messenger.sendMessageToParent(abi.encode(identifier, time, _stampAncillaryData(ancillaryData, msg.sender)));
        }
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function requestPrice(bytes32 identifier, uint256 time) public override nonReentrant() onlyRegisteredContract() {
        bool newPriceRequested = _requestPrice(identifier, time, "0x0");
        if (newPriceRequested) {
            messenger.sendMessageToParent(abi.encode(identifier, time, "0x0"));
        }
    }

    /**
     * @notice Resolves a price request originating from a message sent by the DVM on the parent chain. This method
     * must be called by the ChildMessenger contract which is designed to communicate only with the ParentMessenger
     * contract on Mainnet.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function processMessageFromParent(bytes memory data) public nonReentrant() onlyMessenger() {
        (bytes32 identifier, uint256 time, bytes memory ancillaryData, int256 price) =
            abi.decode(data, (bytes32, uint256, bytes, int256));
        _publishPrice(identifier, time, ancillaryData, price);
    }

    /**
     * @notice Returns whether a price has resolved for the request. This method will not revert.
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
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function hasPrice(bytes32 identifier, uint256 time)
        public
        view
        override
        nonReentrantView()
        onlyRegisteredContract()
        returns (bool)
    {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, "0x0");
        return prices[priceRequestId].state == RequestState.Resolved;
    }

    /**
     * @notice Returns resolved price for the request. Reverts if price is not available.
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
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function getPrice(bytes32 identifier, uint256 time)
        public
        view
        override
        nonReentrantView()
        onlyRegisteredContract()
        returns (int256)
    {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, "0x0");
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
