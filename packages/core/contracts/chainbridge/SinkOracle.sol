// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";

/**
 * @title Extension of BeaconOracle that is intended to be deployed on non-Mainnet networks to give financial
 * contracts on those networks the ability to trigger cross-chain price requests to the Mainnet DVM. Also has the
 * ability to receive published prices from Mainnet.
 * @dev The intended client of this contract is an OptimisticOracle on a non-Mainnet network that needs price
 * resolution secured by the DVM on Mainnet. If a registered contract, such as the OptimisticOracle, calls
 * `requestPrice()` on this contract, then it will call the network's Bridge contract to signal to an off-chain
 * relayer to bridge a price request to Mainnet.
 */
contract SinkOracle is BeaconOracle {
    // Chain ID of the Source Oracle that will communicate this contract's price request to the DVM on Mainnet.
    uint8 public destinationChainID;

    constructor(
        address _finderAddress,
        uint8 _chainID,
        uint8 _destinationChainID
    ) public BeaconOracle(_finderAddress, _chainID) {
        destinationChainID = _destinationChainID;
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
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyRegisteredContract() {
        _requestPrice(currentChainID, identifier, time, ancillaryData);

        // Call Bridge.deposit() to intiate cross-chain price request.
        _getBridge().deposit(
            destinationChainID,
            getResourceId(),
            _formatMetadata(currentChainID, identifier, time, ancillaryData)
        );
    }

    /**
     * @notice This method will ultimately be called after `requestPrice` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid price request,
     * specifically one that has not resolved yet and was called by a registered contract. Without this check,
     * `Bridge.deposit()` could be called by non-registered contracts to make price requests to the DVM.
     */
    function validateDeposit(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view {
        bytes32 priceRequestId = _encodePriceRequest(sinkChainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Requested, "Price has not been requested");
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
     */
    function executePublishPrice(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public onlyGenericHandlerContract() {
        _publishPrice(sinkChainID, identifier, time, ancillaryData, price);
    }

    /**
     * @notice Returns whether a price has resolved for the request.
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
     *     len(data)                              uint256     bytes  0  - 64
     *     data                                   bytes       bytes  64 - END
     */
    function _formatMetadata(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) internal pure returns (bytes memory) {
        bytes memory metadata = abi.encode(chainID, identifier, time, ancillaryData);
        return abi.encodePacked(metadata.length, metadata);
    }
}
