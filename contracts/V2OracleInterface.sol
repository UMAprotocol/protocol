/*
  V2OracleInterface contract.
  The interface that contracts use to query a verified, trusted price.
*/
pragma solidity ^0.5.0;


// This interface allows contracts to query a verified, trusted price.
// TODO(ptare): Blow away OracleInterface and remove the V2 from this name.
interface V2OracleInterface {
    // Returns an Oracle-verified price for symbol if available, otherwise returns `timeForPrice`=0 and a `verifiedTime`
    // that corresponds to the next voting period after which a verified price will be available. If no verified price
    // will ever be available, returns `verifiedTime`=first Ethereum time.
    function getPrice(bytes32 symbol, uint time) external returns (uint timeForPrice, int price, uint verifiedTime);

    // Returns whether the Oracle provides verified prices for the given symbol.
    function isSymbolSupported(bytes32 symbol) external view returns (bool isSupported);

    // An event fired when a request for a (symbol, time) pair is made.
    event VerifiedPriceRequested(bytes32 indexed symbol, uint indexed time);

    // An event fired when a verified price is available for a (symbol, time) pair.
    event VerifiedPriceAvailable(bytes32 indexed symbol, uint indexed time, int price);
}
