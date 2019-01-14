/*
  V2OracleInterface contract.
  The interface that contracts use to query a verified, trusted price.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query a verified, trusted price.
// TODO(ptare): Blow away OracleInterface and remove the V2 from this name.
interface V2OracleInterface {
    // Returns an Oracle-verified price for product if available, otherwise returns `timeForPrice`=0 and a
    // `verifiedTime` that corresponds to the next voting period after which a verified price will be available. If no
    // verified price will ever be available, returns `verifiedTime`=first Ethereum time.
    function getPrice(bytes32 product, uint time) external returns (uint timeForPrice, int price, uint verifiedTime);

    // Returns whether the Oracle provides verified prices for the given product.
    function isProductSupported(bytes32 product) external view returns (bool isSupported);

    // An event fired when a request for a (product, time) pair is made.
    event VerifiedPriceRequested(bytes32 indexed product, uint indexed time);

    // An event fired when a verified price is available for a (product, time) pair.
    event VerifiedPriceAvailable(bytes32 indexed product, uint indexed time, int price);
}
