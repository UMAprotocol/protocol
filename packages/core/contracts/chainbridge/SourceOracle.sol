// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BeaconOracle.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";

/**
 * @title Extension of BeaconOracle that is intended to be deployed on Mainnet to give financial
 * contracts on non-Mainnet networks the ability to trigger cross-chain price requests to the Mainnet DVM. This contract
 * is responsible for triggering price requests originating from non-Mainnet, and broadcasting resolved price data
 * back to those networks. Technically, this contract is more of a Proxy than an Oracle, because it does not implement
 * the full Oracle interface including the getPrice and requestPrice methods. It's goal is to shuttle price request
 * functionality between L2 and L1.
 * @dev The intended client of this contract is some off-chain bot watching for resolved price events on the DVM. Once
 * that bot sees a price has resolved, it can call `publishPrice()` on this contract which will call the local Bridge
 * contract to signal to an off-chain relayer to bridge a price request to another network.
 * @dev This contract must be a registered financial contract in order to call DVM methods.
 */
contract SourceOracle is BeaconOracle {
    /**
     * @notice Constructor.
     * @param _finderAddress Address of Finder that this contract uses to locate Bridge.
     * @param _chainID Chain ID for this contract. This is configurable by the deployer, rather than
     * automatically detected via `block.chainid` because the type of `currentChainId` should match any
     * `sinkChainId`'s submitted as input to `publishPrice()`. `publishPrice()` calls `Bridge.deposit()`
     * which expects a uint8 chainID passed as the first param, but `block.chainid` returns a uint256 value. Due to
     * the possibility that a uint256 --> uint28 conversion leads to data loss and the complexity of mapping safely
     * from uint256 --> uint8 on-chain, we opt to allow the user to specify a unique uint8 ID for this chain. It
     * follows that the `_chainID` may not match with `block.chainid`.
     */
    constructor(address _finderAddress, uint8 _chainID) BeaconOracle(_finderAddress, _chainID) {}

    /***************************************************************
     * Publishing Price Request Data to L2:
     ***************************************************************/

    /**
     * @notice This is the first method that should be called in order to publish a price request to another network
     * marked by `sinkChainID`.
     * @dev Publishes the DVM resolved price for the price request, or reverts if not resolved yet. Will call the
     * local Bridge's deposit() method which will emit a Deposit event in order to signal to an off-chain
     * relayer to begin the cross-chain process.
     * @param sinkChainID Chain ID of SinkOracle that this price should ultimately be sent to.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData extra data of price request to resolve.
     */
    function publishPrice(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public {
        require(_getOracle().hasPrice(identifier, time, ancillaryData), "DVM has not resolved price");
        int256 price = _getOracle().getPrice(identifier, time, ancillaryData);
        _publishPrice(sinkChainID, identifier, time, ancillaryData, price);

        // Initiate cross-chain price request, which should lead the `Bridge` to call `validateDeposit` on this
        // contract.
        _getBridge().deposit(
            sinkChainID,
            getResourceId(),
            formatMetadata(sinkChainID, identifier, time, ancillaryData, price)
        );
    }

    /**
     * @notice This method will ultimately be called after `publishPrice` calls `Bridge.deposit()`, which will call
     * `GenericHandler.deposit()` and ultimately this method.
     * @dev This method should basically check that the `Bridge.deposit()` was triggered by a valid publish event.
     * @param sinkChainID Chain ID of SinkOracle that this price should ultimately be sent to.
     * @param identifier Identifier of price request to resolve.
     * @param time Timestamp of price request to resolve.
     * @param ancillaryData extra data of price request to resolve.
     * @param price Price resolved on DVM to send to SinkOracle.
     */
    function validateDeposit(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public {
        bytes32 priceRequestId = _encodePriceRequest(sinkChainID, identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.price == price, "Unexpected price published");
        // Advance state so that directly calling Bridge.deposit will revert and not emit a duplicate `Deposit` event.
        _finalizePublish(sinkChainID, identifier, time, ancillaryData);
    }

    /***************************************************************
     * Responding to a Price Request from L2:
     ***************************************************************/

    /**
     * @notice This method will ultimately be called after a `requestPrice` has been bridged cross-chain from
     * non-Mainnet to this network via an off-chain relayer. The relayer will call `Bridge.executeProposal` on this
     * local network, which call `GenericHandler.executeProposal()` and ultimately this method.
     * @dev This method should prepare this oracle to receive a published price and then forward the price request
     * to the DVM. Can only be called by the `GenericHandler`.
     * @param sinkChainID Chain ID of SinkOracle that originally sent price request.
     * @param identifier Identifier of price request.
     * @param time Timestamp of price request.
     * @param ancillaryData extra data of price request.
     */

    function executeRequestPrice(
        uint8 sinkChainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public onlyGenericHandlerContract() {
        _requestPrice(sinkChainID, identifier, time, ancillaryData);
        _finalizeRequest(sinkChainID, identifier, time, ancillaryData);
        _getOracle().requestPrice(identifier, time, ancillaryData);
    }

    /**
     * @notice Convenience method to get cross-chain Bridge resource ID linking this contract with its SinkOracles.
     * @dev More details about Resource ID's here: https://chainbridge.chainsafe.io/spec/#resource-id
     * @return bytes32 Hash containing this stored chain ID.
     */
    function getResourceId() public view returns (bytes32) {
        return keccak256(abi.encode("Oracle", currentChainID));
    }

    /**
     * @notice Return DVM for this network.
     */
    function _getOracle() internal view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    /**
     * @notice This helper method is useful for shaping metadata that is passed into Bridge.deposit() that will
     * ultimately be used to publish a price on the SinkOracle.
     * @dev GenericHandler.deposit() expects data to be formatted as:
     *     len(data)                              uint256     bytes  0  - 32
     *     data                                   bytes       bytes  32 - END
     * @param chainID Chain ID of SinkOracle to publish price to.
     * @param identifier Identifier of price request to publish.
     * @param time Timestamp of price request to publish.
     * @param ancillaryData extra data of price request to publish.
     * @return bytes Formatted metadata.
     */
    function formatMetadata(
        uint8 chainID,
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        int256 price
    ) public pure returns (bytes memory) {
        bytes memory metadata = abi.encode(chainID, identifier, time, ancillaryData, price);
        return abi.encodePacked(metadata.length, metadata);
    }
}
