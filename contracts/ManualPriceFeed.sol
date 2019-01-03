/*
  ManualPriceFeed implementation.

 Implementation of PriceFeedInterface that allows manually updating prices.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./PriceFeedInterface.sol";


// Implementation of PriceFeedInterface with the ability to push prices.
contract ManualPriceFeed is PriceFeedInterface, Ownable {

    using SafeMath for uint;

    // A single price update.
    struct PriceTick {
        uint timestamp;
        int256 price;
    }

    // Mapping from symbol to the price series for that symbol.
    mapping(bytes32 => PriceTick[]) private prices;
    // Do we need this separately?
    mapping(bytes32 => bool) private supportedSymbols;

    // Adds a new price to the series for a given symbol. The pushed publishTime must be later than any existing time.
    function pushLatestPrice(bytes32 symbol, uint publishTime, int256 newPrice) external onlyOwner {
        if (prices[symbol].length > 0) {
            uint maxIndex = prices[symbol].length - 1;
            uint maxPublishTime = prices[symbol][maxIndex].timestamp;
            require(publishTime > maxPublishTime);
        }
        prices[symbol].push(PriceTick(publishTime, newPrice));
        emit PriceUpdated(symbol, publishTime, newPrice);
    }

    // Whether this feed has ever published any prices for this symbol.
    function isSymbolSupported(bytes32 symbol) external view returns (bool isSupported) {
        isSupported = prices[symbol].length > 0;
    }

    function latestPrice(bytes32 symbol) external view returns (uint publishTime, int256 price) {
        // Return sentinel values if no prices have been published.
        if (prices[symbol].length == 0) {
            publishTime = 0;
            price = 0;
            return (publishTime, price);
        }
        uint maxIndex = prices[symbol].length - 1;
        publishTime = prices[symbol][maxIndex].timestamp;
        price = prices[symbol][maxIndex].price;
    }

    function priceAtTime(bytes32 symbol, uint time) external view returns (uint publishTime, int256 price) {
        // Return sentinel values if no prices have been published.
        if (prices[symbol].length == 0) {
            publishTime = 0;
            price = 0;
            return (publishTime, price);
        }

        // Find the latest time value that's earlier than the query `time`. Could be optimized with a binary search, but
        // if most queries are for relatively recent price updates, might not be worth it.
        uint index = prices[symbol].length - 1;
        while (index > 0 && prices[symbol][index].timestamp > time) {
            index--;
        }
        if (prices[symbol][index].timestamp > time) {
            // The query `time` is still before the earliest time that a price is available, so return the sentinel
            // values.
            publishTime = 0;
            price = 0;
            return (publishTime, price);
        } else {
            publishTime = prices[symbol][index].timestamp;
            price = prices[symbol][index].price;
        }
    }
}
