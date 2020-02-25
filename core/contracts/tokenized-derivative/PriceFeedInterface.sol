pragma solidity ^0.6.0;

/**
 * @title This interface allows contracts to query unverified prices.
 */
interface PriceFeedInterface {
    /**
     * @notice An event fired when a price is published.
     */
    event PriceUpdated(bytes32 indexed identifier, uint indexed time, int price);

    /**
     * @notice Whether this PriceFeeds provides prices for the given identifier.
     */
    function isIdentifierSupported(bytes32 identifier) external view returns (bool isSupported);

    /**
     * @notice Gets the latest time-price pair at which a price was published.
     * @dev Will revert if no prices have been published for this identifier.
     */
    function latestPrice(bytes32 identifier) external view returns (uint publishTime, int price);
}
