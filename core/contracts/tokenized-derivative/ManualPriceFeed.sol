pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../common/implementation/Testable.sol";
import "../common/implementation/Withdrawable.sol";
import "./PriceFeedInterface.sol";


/**
 * @title Implementation of PriceFeedInterface with the ability to manually push prices.
 */
contract ManualPriceFeed is PriceFeedInterface, Withdrawable, Testable {
    using SafeMath for uint;

    // A single price update.
    struct PriceTick {
        uint256 timestamp;
        int256 price;
    }

    // Mapping from identifier to the latest price for that identifier.
    mapping(bytes32 => PriceTick) private prices;

    // Ethereum timestamp tolerance.
    // Note: this is technically the amount of time that a block timestamp can be *ahead* of the current time. However,
    // we are assuming that blocks will never get more than this amount *behind* the current time. The only requirement
    // limiting how early the timestamp can be is that it must have a later timestamp than its parent. However,
    // this bound will probably work reasonably well in both directions.
    uint256 private constant BLOCK_TIMESTAMP_TOLERANCE = 900;

    enum Roles { Governance, Writer, Withdraw }

    constructor(address _timerAddress) public Testable(_timerAddress) {
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Writer), uint(Roles.Governance), msg.sender);
        _createWithdrawRole(uint(Roles.Withdraw), uint(Roles.Governance), msg.sender);
    }

    /**
     * @notice Adds a new price to the series for a given identifier.
     * @dev The pushed publishTime must be later than the last time pushed so far.
     */
    function pushLatestPrice(bytes32 identifier, uint256 publishTime, int256 newPrice)
        external
        onlyRoleHolder(uint(Roles.Writer))
    {
        require(publishTime <= getCurrentTime().add(BLOCK_TIMESTAMP_TOLERANCE));
        require(publishTime > prices[identifier].timestamp);
        prices[identifier] = PriceTick(publishTime, newPrice);
        emit PriceUpdated(identifier, publishTime, newPrice);
    }

    /**
     * @notice Whether this feed has ever published any prices for this identifier.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isIdentifierSupported(bytes32 identifier) external override view returns (bool isSupported) {
        isSupported = _isIdentifierSupported(identifier);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function latestPrice(bytes32 identifier) external override view returns (uint256 publishTime, int256 price) {
        require(_isIdentifierSupported(identifier));
        publishTime = prices[identifier].timestamp;
        price = prices[identifier].price;
    }

    function _isIdentifierSupported(bytes32 identifier) private view returns (bool isSupported) {
        isSupported = prices[identifier].timestamp > 0;
    }
}
