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

    // Mapping from symbol to the latest price for that symbol.
    mapping(bytes32 => PriceTick) private prices;

    // Adds a new price to the series for a given symbol. The pushed publishTime must be later than the last time pushed
    // so far.
    function pushLatestPrice(bytes32 symbol, uint publishTime, int256 newPrice) external onlyOwner {
        require(publishTime > prices[symbol].timestamp);
        prices[symbol] = PriceTick(publishTime, newPrice);
        emit PriceUpdated(symbol, publishTime, newPrice);
    }

    // Whether this feed has ever published any prices for this symbol.
    function isSymbolSupported(bytes32 symbol) external view returns (bool isSupported) {
        isSupported = prices[symbol].timestamp > 0;
    }

    function latestPrice(bytes32 symbol) external view returns (uint publishTime, int256 price) {
        publishTime = prices[symbol].timestamp;
        price = prices[symbol].price;
    }
}
