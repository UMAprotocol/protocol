// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BeaconOracle.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../oracle/interfaces/RegistryInterface.sol";

/**
 * @title Extension of BeaconOracle that is intended to be deployed on non-Mainnet networks to give financial
 * contracts on those networks the ability to trigger cross-chain price requests to the Mainnet DVM. Also has the
 * ability to receive published prices from Mainnet. This contract can be treated as the "DVM" for a non-Mainnet
 * network, because a calling contract can request and access a resolved price request from this contract.
 * @dev The intended client of this contract is an OptimisticOracle on a non-Mainnet network that needs price
 * resolution secured by the DVM on Mainnet. If a registered contract, such as the OptimisticOracle, calls
 * `requestPrice()` on this contract, then it will call the network's Bridge contract to signal to an off-chain
 * relayer to bridge a price request to Mainnet.
 */
contract SinkOracle is BeaconOracle, OracleAncillaryInterface {
    // Chain ID of the Source Oracle that will communicate this contract's price request to the DVM on Mainnet.
    uint8 public destinationChainID;

    /**
     * @notice Constructor.
     * @param _finderAddress Address of Finder that this contract uses to locate Bridge.
     * @param _chainID Chain ID for this contract.
     * @param _destinationChainID Chain ID for SourceOracle that will resolve price requests sent from this contract.
     */
    constructor(
        address _finderAddress,
        uint8 _chainID,
        uint8 _destinationChainID
    ) BeaconOracle(_finderAddress, _chainID) {
        destinationChainID = _destinationChainID;
    }

    // This assumes that the local network has a Registry that resembles the Mainnet registry.
    modifier onlyRegisteredContract() {
        RegistryInterface registry = RegistryInterface(finder.getImplementationAddress(OracleInterfaces.Registry));
        require(registry.isContractRegistered(msg.sender), "Caller must be registered");
        _;
    }

    /***************************************************************
     * Bridging a Price Request to L1:
     ***************************************************************/

    /**
     * @notice This is the first method that should be called in order to bridge a price request to Mainnet.
     * @dev Can be called only by a Registered contract that is allowed to make DVM price requests. Will mark this
     * price request as Requested, and therefore able to receive the ultimate price resolution data, and also
     * calls the local Bridge's deposit() method which will emit a Deposit event in order to signal to an off-chain
     * relayer to begin the cross-chain process.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyRegisteredContract() {
        bytes32 priceRequestId = _encodePriceRequest(currentChainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        if (lookup.state != RequestState.NeverRequested) {
            // Clients expect that `requestPrice` does not revert if a price is already requested, so return gracefully.
            return;
        } else {
            _requestPrice(currentChainID, identifier, time, ancillaryData);

            // Initiate cross-chain price request, which should lead the `Bridge` to call `validateDeposit` on this
            // contract.
            _getBridge().deposit(
                destinationChainID,
                getResourceId(),
                formatMetadata(currentChainID, identifier, time, ancillaryData)
            );
        }
    }

    /**
     * @notice This method will ultimately be called after `requestPrice` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid price request,
     * specifically one that has not resolved yet and was called by a registered contract. Without this check,
     * `Bridge.deposit()` could be called by non-registered contracts to make price requests to the DVM.
     * @param sinkChainID Chain ID for this contract.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */
    function validateDeposit(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        // Advance state so that directly calling Bridge.deposit will revert and not emit a duplicate `Deposit` event.
        _finalizeRequest(sinkChainID, identifier, time, ancillaryData);
    }

    /***************************************************************
     * Responding to Price Request Resolution from L1:
     ***************************************************************/

    /**
     * @notice This method will ultimately be called after a `publishPrice` has been bridged cross-chain from Mainnet
     * to this network via an off-chain relayer. The relayer will call `Bridge.executeProposal` on this local network,
     * which call `GenericHandler.executeProposal()` and ultimately this method.
     * @dev This method should publish the price data for a requested price request. If this method fails for some
     * reason, then it means that the price was never requested. Can only be called by the `GenericHandler`.
     * @param sinkChainID Chain ID for this contract.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData extra data of price request to resolve.
     * @param price Price to publish to this oracle.
     */
    function executePublishPrice(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public onlyGenericHandlerContract() {
        _publishPrice(sinkChainID, identifier, time, ancillaryData, price);
        _finalizePublish(sinkChainID, identifier, time, ancillaryData);
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
        bytes32 priceRequestId = _encodePriceRequest(currentChainID, identifier, time, ancillaryData);
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
        bytes32 priceRequestId = _encodePriceRequest(currentChainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Convenience method to get cross-chain Bridge resource ID linking this contract with the SourceOracle.
     * @dev More details about Resource ID's here: https://chainbridge.chainsafe.io/spec/#resource-id
     * @return bytes32 Hash containing the chain ID of the SourceOracle.
     */
    function getResourceId() public view returns (bytes32) {
        return keccak256(abi.encode("Oracle", destinationChainID));
    }

    /**
     * @notice This helper method is useful for calling Bridge.deposit().
     * @dev GenericHandler.deposit() expects data to be formatted as:
     *     len(data)                              uint256     bytes  0  - 32
     *     data                                   bytes       bytes  32 - END
     * @param chainID Chain ID for this contract.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     * @return bytes Formatted metadata.
     */
    function formatMetadata(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public pure returns (bytes memory) {
        bytes memory metadata = abi.encode(chainID, identifier, time, ancillaryData);
        return abi.encodePacked(metadata.length, metadata);
    }
}
