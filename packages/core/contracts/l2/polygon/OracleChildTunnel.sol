// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./tunnel/FxBaseChildTunnel.sol";
import "../../oracle/interfaces/OracleAncillaryInterface.sol";
import "../../oracle/interfaces/RegistryInterface.sol";
import "./OracleBaseTunnel.sol";

/**
 * @title Adapter deployed on L2 to give financial contracts the ability to trigger cross-chain price requests to the
 * L1 DVM. Also has the ability to receive published prices from L1. This contract can be treated as the "DVM" for this
 * network, because a calling contract can request and access a resolved price request from this contract.
 * @dev The intended client of this contract is an OptimisticOracle on L2 that needs price
 * resolution secured by the DVM on L1.
 */
contract OracleChildTunnel is OracleBaseTunnel, OracleAncillaryInterface, FxBaseChildTunnel {
    constructor(address _fxChild, address _finderAddress)
        OracleBaseTunnel(_finderAddress)
        FxBaseChildTunnel(_fxChild)
    {}

    // This assumes that the local network has a Registry that resembles the Mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    /**
     * @notice This should be called to bridge a price request to Mainnet.
     * @dev Can be called only by a Registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the price resolution data from L1. Emits a message
     * that will be included in regular checkpoint of all Matic transactions to Ethereum.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyRegisteredContract() {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state != RequestState.NeverRequested) {
            // Clients expect that `requestPrice` does not revert if a price is already requested, so return gracefully.
            // TODO: Should we allow duplicate price requests to emit multiple Messages via _sendMessageToRoot? The DVM
            // on L1 will not have a problem handling duplicate requests, as it will just ignore them. This could be
            // useful if the checkpointing on Ethereum for some reason misses a Message.
            return;
        } else {
            _requestPrice(identifier, time, ancillaryData);

            // Initiate cross-chain price request:
            // TODO: Can we pack more information into this request? We could try to check if the requester is an
            // OptimisticOracle and pull price request metadata from that?
            _sendMessageToRoot(abi.encode(identifier, time, ancillaryData));
        }
    }

    /** 
     * @notice Resolves a price request.
     * @dev The data will be received automatically from the state receiver when the state is synced between Ethereum
     * and Polygon. This will revert if the Root chain sender is not the `fxRootTunnel` contract.
     * This is called by an `onStateReceive` function, and since it is called via a system call, no event will be 
     * emitted during its execution. More details here: https://docs.matic.network/docs/contribute/bor/core_concepts/#system-call
     * @param sender The sender of `data` from the Root chain.
     * @param data ABI encoded params with which to call `_publishPrice`.
     */
    function _processMessageFromRoot(
        uint256, /* stateId */
        address sender,
        bytes memory data
    ) internal override validateSender(sender) {
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
    ) public view override onlyRegisteredContract() returns (bool) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
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
    ) public view override onlyRegisteredContract() returns (int256) {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }
}
