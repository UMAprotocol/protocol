// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import "../data-verification-mechanism/interfaces/OracleInterface.sol";
import "../data-verification-mechanism/interfaces/RegistryInterface.sol";
import "./OracleBase.sol";
import "../common/implementation/AncillaryData.sol";
import "../common/implementation/Lockable.sol";
import "./interfaces/ChildMessengerInterface.sol";
import "./interfaces/ChildMessengerConsumerInterface.sol";
import "./SpokeBase.sol";

/**
 * @title Cross-chain Oracle L2 Oracle Spoke.
 * @notice This contract is primarily intended to receive messages on the child chain from a parent chain and allow
 * contracts deployed on the child chain to interact with this contract as an Oracle. Moreover, this contract gives
 * child chain contracts the ability to trigger cross-chain price requests to the mainnet DVM. This Spoke knows how
 * to communicate with the parent chain via a "ChildMessenger" contract which directly communicates with the
 * "ParentMessenger" on mainnet.
 * @dev The intended client of this contract is an OptimisticOracle on sidechain that needs price
 * resolution secured by the DVM on mainnet.
 */
contract OracleSpoke is
    OracleBase,
    SpokeBase,
    OracleAncillaryInterface,
    OracleInterface,
    ChildMessengerConsumerInterface,
    Lockable
{
    constructor(address _finderAddress) HasFinder(_finderAddress) {}

    // This assumes that the local network has a Registry that resembles the mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    /**
     * @notice This is called to bridge a price request to mainnet. This method will enqueue a new price request
     * or return silently if already requested. Price requests are relayed to mainnet (the "Parent" chain) via the
     * ChildMessenger contract.
     * @dev Can be called only by a registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the price resolution data from mainnet.
     * @dev Contract registration enables the DVM to validate that the calling contract correctly pays final fees.
     * Therefore, this function does not directly attempt to pull a final fee from the caller.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override nonReentrant() onlyRegisteredContract() {
        bool newPriceRequested = _requestPrice(identifier, time, _stampAncillaryData(ancillaryData));
        if (newPriceRequested) {
            getChildMessenger().sendMessageToParent(abi.encode(identifier, time, _stampAncillaryData(ancillaryData)));
        }
    }

    /**
     * @notice Overloaded function to provide backwards compatibility for legacy financial contracts that do not use
     * ancillary data.
     */
    function requestPrice(bytes32 identifier, uint256 time) public override nonReentrant() onlyRegisteredContract() {
        bool newPriceRequested = _requestPrice(identifier, time, _stampAncillaryData(""));
        if (newPriceRequested) {
            getChildMessenger().sendMessageToParent(abi.encode(identifier, time, _stampAncillaryData("")));
        }
    }

    /**
     * @notice Resolves a price request originating from a message sent by the DVM on the parent chain.
     * @dev Can only be called by the ChildMessenger contract which is designed to communicate only with the
     * ParentMessenger contract on Mainnet. See the SpokeBase for the onlyMessenger modifier.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function processMessageFromParent(bytes memory data) public override nonReentrant() onlyMessenger() {
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(""));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(ancillaryData));
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
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, _stampAncillaryData(""));
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Generates stamped ancillary data in the format that it would be used in the case of a price request.
     * @param ancillaryData ancillary data of the price being requested.
     * @return the stamped ancillary bytes.
     */
    function stampAncillaryData(bytes memory ancillaryData) public view nonReentrantView() returns (bytes memory) {
        return _stampAncillaryData(ancillaryData);
    }

    /**
     * @dev We don't handle specifically the case where `ancillaryData` is not already readily translatable in utf8.
     * For those cases, we assume that the client will be able to strip out the utf8-translatable part of the
     * ancillary data that this contract stamps.
     */
    function _stampAncillaryData(bytes memory ancillaryData) internal view returns (bytes memory) {
        // This contract should stamp the child network's ID so that voters on the parent network can
        // deterministically track unique price requests back to this contract.
        return AncillaryData.appendKeyValueUint(ancillaryData, "childChainId", block.chainid);
    }
}
