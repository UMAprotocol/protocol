/*
  VoteTokenMock implementation.

  Simple mock implementation of a Vote Token to be used by a derivative for querying price feeds.
*/
pragma solidity ^0.4.24;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./VoteTokenInterface.sol";


contract VoteTokenMock is VoteTokenInterface {
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

    FeedInfo private unverifiedFeed;
    FeedInfo private verifiedFeed;

    // First time at which a price will be published.
    uint private startTime;

    // The publishing interval for this price feed. All publish times are just multiples of this interval starting at 0.
    uint constant private PRICE_PUBLISH_INTERVAL = 60;

    constructor(
        uint startTime_
    ) public {
        startTime = intervalTime(startTime_, startTime_);
    }

    function mostRecentUnverifiedPublishingTime() public view returns (uint publishTime) {
        return unverifiedFeed.latestPublishTime;
    }

    function mostRecentUnverifiedPublishingTime(uint time) public view returns (uint publishTime) {
        return intervalTime(time, unverifiedFeed.latestPublishTime);
    }

    function getUnverifiedPrice(uint publishTime) public view returns (bool success, int256 price) {
        return getPrice(publishTime, unverifiedFeed);
    }

    function mostRecentVerifiedPublishingTime() public view returns (uint publishTime) {
        return verifiedFeed.latestPublishTime;
    }

    function mostRecentVerifiedPublishingTime(uint time) public view returns (uint publishedTime) {
        return intervalTime(time, verifiedFeed.latestPublishTime);
    }

    function getVerifiedPrice(uint publishTime) public view returns (bool success, int256 price) {
        return getPrice(publishTime, verifiedFeed);
    }

    // Gets the price given a desired time and feed. If the time is not a valid, published time for that feed,
    // `success` will be false and `price` should be ignored. 
    function getPrice(uint publishTime, FeedInfo storage feedInfo) private view returns (bool success, int256 price) {
        uint convertedTime = intervalTime(publishTime, feedInfo.latestPublishTime);
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
    function intervalTime(uint time, uint latestFeedTime) private view returns (uint timeInInterval) {
        if (time < latestFeedTime) {
            return time < startTime ? 0 : time.div(PRICE_PUBLISH_INTERVAL).mul(PRICE_PUBLISH_INTERVAL);
        } else {
            return latestFeedTime;
        }
    }
}
