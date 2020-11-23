pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "./FinancialProductLibrary.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface ExpiringContractInterface {
    function expirationTimestamp() external view returns (uint256);
}

/**
 * @title Structured Note Financial Product Library
 * @notice Adds custom price transformation logic to modify the behavour of the expiring multi party contract.  The
 * contract holds say 1 WETH in collateral and pays out that 1 WETH if, at expiry, ETHUSD is below a set strike. If
 * ETHUSD is above that strike, the contract pays out a given dollar amount of ETH.
 * Example: expiry is DEC 31. Strike is $400. Each token is backed by 1 WETH
 * If ETHUSD < $400 at expiry, token is redeemed for 1 ETH.
 * If ETHUSD >= $400 at expiry, token is redeemed for $400 worth of ETH, as determine by the DVM.
 */
contract StructuredNoteFinancialProductLibrary is FinancialProductLibrary, Ownable {
    mapping(address => FixedPoint.Unsigned) financialProductStrikes;

    constructor() public {}

    /**
     * @notice Enables the deployer of the library to set the strike price for an associated financial product.
     * @param financialProduct address of the financial product.
     * @param strikePrice the strike price for the structured note to be applied to the financial product.
     * @dev Note: a) Only the owner (deployer) of this library can set new strike prices b) A strike price can not be 0.
     * b) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * c)  financialProduct must exposes an expirationTimestamp method.
     */
    function setFinancialProductStrike(address financialProduct, FixedPoint.Unsigned memory strikePrice)
        public
        onlyOwner
    {
        require(strikePrice.isGreaterThan(0), "Cant set 0 strike");
        require(financialProductStrikes[financialProduct].isEqual(0), "Strike already set");
        require(ExpiringContractInterface(financialProduct).expirationTimestamp() != 0, "Invalid EMP contract");
        financialProductStrikes[financialProduct] = strikePrice;
    }

    /**
     * @notice Returns the strike price associated with a given financial product address.
     * @param financialProduct address of the financial product.
     * @return strikePrice for the associated financial product.
     */
    function getStrikeForFinancialProduct(address financialProduct) public view returns (FixedPoint.Unsigned memory) {
        return financialProductStrikes[financialProduct];
    }

    /**
     * @notice Returns a transformed price by applying the structured note payout structure.
     * @param oraclePrice price from the oracle to be transformed.
     * @param requestTime timestamp the oraclePrice was requested at.
     * @return transformedPrice the input oracle price with the price transformation logic applied to it.
     */
    function transformPrice(FixedPoint.Unsigned memory oraclePrice, uint256 requestTime)
        public
        view
        override
        returns (FixedPoint.Unsigned memory)
    {
        FixedPoint.Unsigned memory strike = financialProductStrikes[msg.sender];
        require(strike.isGreaterThan(0), "Caller has no strike");
        // If price request is made before expiry, return 1. Thus we can keep the contract 100% collateralized with
        // each token backed 1:1 by collateral currency.
        if (requestTime < ExpiringContractInterface(msg.sender).expirationTimestamp()) {
            return FixedPoint.fromUnscaledUint(1);
        }
        if (oraclePrice.isLessThan(strike)) {
            return FixedPoint.fromUnscaledUint(1);
        } else {
            // Token expires to be worth strike $ worth of collateral.
            // eg if ETHUSD is $500 and strike is $400, token is redeemable for 400/500 = 0.8 WETH.
            return strike.div(oraclePrice);
        }
    }
}
