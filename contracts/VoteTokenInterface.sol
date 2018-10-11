/*
  VoteTokenInterface contract.
  The interface that contracts use to query verified and unverified price feeds.
*/
pragma solidity ^0.4.24;


// This interface allows contracts to query verified and unverified prices from the VoteToken.
interface VoteTokenInterface {
    // Gets the latest price-time pair at which an unverified price was published. `publishTime` will be 0 and `price`
    // should be ignored if no unverified prices have been published.
    function latestUnverifiedPrice() external view returns (uint publishTime, int256 price);

    // Gets the latest price-time pair at which a verified price was published. `publishTime` will be 0 and `price`
    // should be ignored if no verified prices have been published.
    function latestVerifiedPrice() external view returns (uint publishTime, int256 price);

    // Gets the price-time pair that an unverified price was published that is nearest to `time` without being greater
    // than `time`. `publishTime` will be 0 and `price` should be ignored if no unverified prices had been published
    // before `publishTime`.
    function unverifiedPrice(uint time) external view returns (uint publishTime, int256 price);

    // Gets the price-time pair that a verified price was published that is nearest to `time` without being greater
    // than `time`. `publishTime` will be 0 and `price` should be ignored if no verified prices had been published
    // before `publishTime`.
    function verifiedPrice(uint time) external view returns (uint publishTime, int256 price);
}
