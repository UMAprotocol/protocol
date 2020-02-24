pragma solidity ^0.5.0;

/**
 * @title Financial contract facing Oracle interface.
 * @dev Interface used by financial contracts to interact with the Oracle. Voters will use a different interface.
 */
interface OracleInterface {
    /**
     * @notice Enqueues a request (if a request isn't already present) for the given `identifier`, `time` pair.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. eg BTC/USD, bytes32 encoded could be requested.
     * @param time unix timestamp of for the price request.
     */
    function requestPrice(bytes32 identifier, uint time) external;

    /**
     * @notice Whether the price for `identifier` and `time` is available.
     * @dev Time must be in the past and the identifier must be supported.
     * @param identifier uniquely identifies the price requested. eg BTC/USD, bytes32 encoded could be requested.
     * @param time unix timestamp of for the price request.
     * @return bool if the DVM has resolved to a price for the given identifier and timestamp.
     */
    function hasPrice(bytes32 identifier, uint time) external view returns (bool);

    /**
     * @notice Gets the price for `identifier` and `time` if it has already been requested and resolved.
     * @dev If the price is not available, the method reverts.
     * @param identifier uniquely identifies the price requested. eg BTC/USD, bytes32 encoded could be requested.
     * @param time unix timestamp of for the price request.
     * @return int representing the resolved price for the given identifer and timestamp.
     */
    function getPrice(bytes32 identifier, uint time) external view returns (int price);
}
