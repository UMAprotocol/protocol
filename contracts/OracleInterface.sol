/*
  OracleInterface contract.
  The interface that contracts use to query a verified, trusted price.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query a verified, trusted price.
interface OracleInterface {
    // Returns an Oracle-verified price for identifier if available, otherwise returns `timeForPrice`=0 and a
    // `verifiedTime` that corresponds to the next voting period after which a verified price will be available. If no
    // verified price will ever be available, returns `verifiedTime`=first Ethereum time. Only contracts registered
    // in the Registry are authorized to call this method.
    function getPrice(bytes32 identifier, uint time) external returns (uint timeForPrice, int price, uint verifiedTime);

    // Returns whether the Oracle provides verified prices for the given identifier.
    function isIdentifierSupported(bytes32 identifier) external view returns (bool isSupported);

    // An event fired when a request for a (identifier, time) pair is made.
    event VerifiedPriceRequested(bytes32 indexed identifier, uint indexed time);

    // An event fired when a verified price is available for a (identifier, time) pair.
    event VerifiedPriceAvailable(bytes32 indexed identifier, uint indexed time, int price);
}
