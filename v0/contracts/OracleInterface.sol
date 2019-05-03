/*
  OracleInterface contract.
  The interface that contracts use to query a verified, trusted price.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query a verified, trusted price.
interface OracleInterface {
    // Requests the Oracle price for an identifier at a time. Returns the time at which a price will be available.
    // Returns 0 is the price is available now, and returns 2^256-1 if the price will never be available.  Reverts if
    // the Oracle doesn't support this identifier. Only contracts registered in the Registry are authorized to call this
    // method.
    function requestPrice(bytes32 identifier, uint time) external returns (uint expectedTime);

    // Checks whether a price has been resolved.
    function hasPrice(bytes32 identifier, uint time) external view returns (bool hasPriceAvailable);

    // Returns the Oracle price for identifier at a time. Reverts if the Oracle doesn't support this identifier or if
    // the Oracle doesn't have a price for this time. Only contracts registered in the Registry are authorized to call
    // this method.
    function getPrice(bytes32 identifier, uint time) external view returns (int price);

    // Returns whether the Oracle provides verified prices for the given identifier.
    function isIdentifierSupported(bytes32 identifier) external view returns (bool isSupported);

    // An event fired when a request for a (identifier, time) pair is made.
    event VerifiedPriceRequested(bytes32 indexed identifier, uint indexed time);

    // An event fired when a verified price is available for a (identifier, time) pair.
    event VerifiedPriceAvailable(bytes32 indexed identifier, uint indexed time, int price);
}
