/*
  PriceFeedInterface contract.
  The interface that contracts use to query unverified price feeds.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query unverified prices.
interface PriceFeedInterface {
    // Whether this PriceFeeds provides prices for the given identifier.
    function isIdentifierSupported(bytes32 identifier) external view returns (bool isSupported);

    // Gets the latest time-price pair at which a price was published. The transaction will revert if no prices have
    // been published for this identifier.
    function latestPrice(bytes32 identifier) external view returns (uint publishTime, int price);

    // An event fired when a price is published.
    event PriceUpdated(bytes32 indexed identifier, uint indexed time, int price);
}
