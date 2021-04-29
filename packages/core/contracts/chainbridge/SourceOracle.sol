// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "./BeaconOracle.sol";

/**
 * @title Simple implementation of the OracleInterface that is intended to be deployed on Mainnet and used
 * to communicate price request data cross-chain with Sink Oracles on non-Mainnet networks. An Admin can publish
 * prices to this oracle. An off-chain relayer can subsequently see when prices are published and signal to publish
 * those prices to any non-Mainnet Sink Oracles.
 * @dev This contract should be able to make price requests to the DVM, and the Admin capable of making and publishing
 * price reqests should be an off-chain relayer capable of detecting signals from the non-Mainnet Sink Oracles.
 */
/**
 * @title Extension of BeaconOracle that is intended to be deployed on Mainnet to give financial
 * contracts on non-Mainnet networks the ability to trigger cross-chain price requests to the Mainnet DVM. This contract
 * is responsible for triggering price requests originating from non-Mainnet, and broadcasting resolved price data
 * back to those networks.
 * @dev The intended client of this contract is some off-chain bot watching for resolved price events on the DVM. Once
 * that bot sees a price has resolved, it can call `publishPrice()` on this contract which will call the local Bridge
 * contract to signal to an off-chain relayer to bridge a price request to another network.
 */
contract SourceOracle is BeaconOracle {
    constructor(address _finderAddress, uint8 _chainID) public BeaconOracle(_finderAddress, _chainID) {}

    /***************************************************************
     * Publishing Price Request Data from Mainnet:
     ***************************************************************/

    /***************************************************************
     * Bridging a Price Request to Mainnet:
     ***************************************************************/

    /**
     * @notice This is the first method that should be called in order to publish a price request to another network
     * marked by `destinationChainID`.
     * @dev Can only be called with the same `price` that has been resolved for this request on the DVM. Will call the
     * local Bridge's deposit() method which will emit a Deposit event in order to signal to an off-chain
     * relayer to begin the cross-chain process.
     */
    function publishPrice(
        uint8 destinationChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        require(_getOracle().hasPrice(identifier, time, ancillaryData), "DVM has not resolved price");
        require(_getOracle().getPrice(identifier, time, ancillaryData) == price, "DVM resolved different price");
        _publishPrice(identifier, time, ancillaryData, price);

        // Call Bridge.deposit() to initiate cross-chain publishing of price request.
        _getBridge().deposit(
            destinationChainID,
            getResourceId(),
            _formatMetadata(identifier, time, ancillaryData, price)
        );
    }

    /**
     * @notice This method will ultimately be called after `publishPrice` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid publish event.
     */
    function validateDeposit(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public view {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been published");
    }

    /**
     * @notice This method will ultimately be called after a `requestPrice` has been bridged cross-chain from
     * non-Mainnet to this network via an off-chain relayer. The relayer will call `Bridge.executeProposal` on this
     * local network, which call `GenericHandler.executeProposal()` and ultimately this method.
     * @dev This method should prepare this oracle to receive a published price and then forward the price request
     * to the DVM. Can only be called by the `GenericHandler`.
     */

    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public override onlyGenericHandlerContract() {
        _requestPrice(identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    /**
     * @notice Return DVM for this network.
     */
    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    /**
     * @notice This helper method is useful for calling Bridge.deposit().
     * @dev GenericHandler.deposit() expects data to be formatted as:
     *     len(data)                              uint256     bytes  0  - 64
     *     data                                   bytes       bytes  64 - END
     */
    function _formatMetadata(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) internal view returns (bytes memory) {
        bytes memory metadata = abi.encode(identifier, time, ancillaryData, price);
        return abi.encodePacked(metadata.length, metadata);
    }
}
