/*
  PriceFeedInterface contract.
  The interface that contracts use to query unverified price feeds.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query unverified prices.
interface PriceFeedInterface {
    // Whether this PriceFeeds provides prices for the given symbol.
    function isSymbolSupported(bytes32 symbol) external view returns (bool isSupported);

    // Gets the latest time-price pair at which a price was published. `publishTime` will be 0 and `price` should be
    // ignored if no prices have ever been published for this symbol.
    function latestPrice(bytes32 symbol) external view returns (uint publishTime, int256 price);

    // Gets the time-price pair at which a price was published that is nearest to `time` without being greater than
    // `time`. `publishTime` will be 0 and `price` should be ignored if no prices have been published before `time`.
    function priceAtTime(bytes32 symbol, uint time) external view returns (uint publishTime, int256 price);

    // An event fired when a price is published.
    event PriceUpdated(bytes32 symbol, uint time, int256 price);
}
