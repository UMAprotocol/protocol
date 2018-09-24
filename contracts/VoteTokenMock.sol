/*
  VoteTokenMock implementation.

  Simple mock implementation of a Vote Token to be used by a derivative for querying price feeds.
*/
pragma solidity ^0.4.24;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./VoteTokenInterface.sol";


contract VoteTokenMock is VoteTokenInterface, Ownable {
    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    struct FeedInfo {
        // TODO(mattrice): may be more gas efficient to store these maps as arrays since the prices are published at
        // regular intervals and an index offset could be easily computed from the time.
        // Maps from the timestamp to the price at that time.
        mapping(uint => int256) prices;

        // Most recent publish times for each price feed.
        uint latestPublishTime;
    }

    FeedInfo private _unverifiedFeed;
    FeedInfo private _verifiedFeed;

    // First time at which a price will be published.
    uint private _startTime;

    // The publishing interval for this price feed. All publish times are just multiples of this interval starting at 0.
    uint constant private PRICE_PUBLISH_INTERVAL = 60;

    constructor(
        uint startTime
    ) public {
        _startTime = _intervalTime(startTime, startTime);
    }

    // These functions are only here for the purpose of mocking a real feed. If this were meant for production, we
    // would want to provide the time and check that the time lines up with the expected next time on the feed.
    function addUnverifiedPrice(int256 newPrice) public onlyOwner {
        _addNextPriceToFeed(newPrice, _unverifiedFeed);
    }

    function addVerifiedPrice(int256 newPrice) public onlyOwner {
        _addNextPriceToFeed(newPrice, _verifiedFeed);
    }

    function mostRecentUnverifiedPublishingTime() public view returns (uint publishTime) {
        return _unverifiedFeed.latestPublishTime;
    }

    function mostRecentUnverifiedPublishingTime(uint time) public view returns (uint publishTime) {
        return _intervalTime(time, _unverifiedFeed.latestPublishTime);
    }

    function mostRecentVerifiedPublishingTime() public view returns (uint publishTime) {
        return _verifiedFeed.latestPublishTime;
    }

    function mostRecentVerifiedPublishingTime(uint time) public view returns (uint publishedTime) {
        return _intervalTime(time, _verifiedFeed.latestPublishTime);
    }

    function unverifiedPrice(uint publishTime) public view returns (bool success, int256 price) {
        return _getPrice(publishTime, _unverifiedFeed);
    }

    function verifiedPrice(uint publishTime) public view returns (bool success, int256 price) {
        return _getPrice(publishTime, _verifiedFeed);
    }

    // Adds a new price to the mocked out feed. If this were meant for production, we would want to provide the time
    // and check that the time lines up with the expected next time on the feed.
    function _addNextPriceToFeed(int256 newPrice, FeedInfo storage feedInfo) private {
        uint newTime = feedInfo.latestPublishTime.add(PRICE_PUBLISH_INTERVAL);
        assert(feedInfo.prices[newTime] == 0);
        feedInfo.prices[newTime] = newPrice;
        feedInfo.latestPublishTime = newTime;
    }

    // Gets the price given a desired time and feed. If the time is not a valid, published time for that feed,
    // `success` will be false and `price` should be ignored. 
    function _getPrice(uint publishTime, FeedInfo storage feedInfo) private view returns (bool success, int256 price) {
        uint convertedTime = _intervalTime(publishTime, feedInfo.latestPublishTime);
        if (convertedTime == publishTime && convertedTime != 0) {
            success = true;
            price = feedInfo.prices[convertedTime];
        } else {
            success = false;
        }
    }

    // Gets the closest earlier time to `time` for a particular feed. Effectively floors `time` to the nearest multiple
    // of `PRICE_PUBLISH_INTERVAL` unless the time is outside the bounds of the published times for that feed. If
    // `time` is later than `latestFeedTime`, `latestFeedTime` is returned. If time is before the global
    // `startTime` of this feed, then 0 is returned.
    function _intervalTime(uint time, uint latestFeedTime) private view returns (uint timeInInterval) {
        if (time < latestFeedTime) {
            return time < _startTime ? 0 : time.div(PRICE_PUBLISH_INTERVAL).mul(PRICE_PUBLISH_INTERVAL);
        } else {
            return latestFeedTime;
        }
    }
}
