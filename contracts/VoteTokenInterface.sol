/*
  VoteTokenInterface contract.
  The interface that contracts use to query verified and unverified price feeds.
*/
pragma solidity ^0.4.24;


// This interface allows contracts to query verified and unverified prices from the VoteToken.
contract VoteTokenInterface {
    // Gets the latest time that an unverified price was published. Returns 0 if no unverified prices have been
    // published.
    function mostRecentUnverifiedPublishingTime() public view returns (uint publishTime);

    // Gets the time that an unverified price was published that is nearest to `time` without being greater than
    // `time`. Returns 0 if no verified prices had been published before `time`.
    function mostRecentUnverifiedPublishingTime(uint time) public view returns (uint publishTime);

    // Gets the latest time that a verified price was published. Returns 0 if no verified prices have been published.
    function mostRecentVerifiedPublishingTime() public view returns (uint publishTime);

    // Gets the time that a verified price was published that is nearest to `time` without being greater than
    // `time`. Returns 0 if no verified prices had been published before `time`.
    function mostRecentVerifiedPublishingTime(uint time) public view returns (uint publishTime);

    // Gets the unverified price at `publishTime`. If no price was recorded for `publishTime`, then `success` will be
    // false and the value of `price` should be ignored.
    function unverifiedPrice(uint publishTime) public view returns (bool success, int256 price);

    // Gets the verified price at `publishTime`. If no price was recorded for `publishTime`, then `success` will be
    // false and the value of `price` should be ignored.
    function verifiedPrice(uint publishTime) public view returns (bool success, int256 price);
}
