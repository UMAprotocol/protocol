/*
  ManualPriceFeed implementation.

 Implementation of PriceFeedInterface that allows manually updating prices.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./PriceFeedInterface.sol";
import "./Testable.sol";


// Implementation of PriceFeedInterface with the ability to push prices.
contract ManualPriceFeed is PriceFeedInterface, Ownable, Testable {

    using SafeMath for uint;

    // A single price update.
    struct PriceTick {
        uint timestamp;
        int price;
    }

    // Mapping from symbol to the latest price for that symbol.
    mapping(bytes32 => PriceTick) private prices;

    // Ethereum timestamp tolerance.
    // Note: this is technically the amount of time that a block timestamp can be *ahead* of the current time. However,
    // we are assuming that blocks will never get more than this amount *behind* the current time. The only requirement
    // limiting how early the timestamp can be is that it must have a later timestamp than its parent. However,
    // this bound will probably work reasonably well in both directions.
    uint constant private BLOCK_TIMESTAMP_TOLERANCE = 900;

    constructor(bool _isTest) public Testable(_isTest) {} // solhint-disable-line no-empty-blocks

    // Adds a new price to the series for a given symbol. The pushed publishTime must be later than the last time pushed
    // so far.
    function pushLatestPrice(bytes32 symbol, uint publishTime, int newPrice) external onlyOwner {
        require(publishTime <= getCurrentTime().add(BLOCK_TIMESTAMP_TOLERANCE));
        require(publishTime > prices[symbol].timestamp);
        prices[symbol] = PriceTick(publishTime, newPrice);
        emit PriceUpdated(symbol, publishTime, newPrice);
    }

    // Whether this feed has ever published any prices for this symbol.
    function isSymbolSupported(bytes32 symbol) external view returns (bool isSupported) {
        isSupported = _isSymbolSupported(symbol);
    }

    function latestPrice(bytes32 symbol) external view returns (uint publishTime, int price) {
        require(_isSymbolSupported(symbol));
        publishTime = prices[symbol].timestamp;
        price = prices[symbol].price;
    }

    function _isSymbolSupported(bytes32 symbol) private view returns (bool isSupported) {
        isSupported = prices[symbol].timestamp > 0;
    }
}
