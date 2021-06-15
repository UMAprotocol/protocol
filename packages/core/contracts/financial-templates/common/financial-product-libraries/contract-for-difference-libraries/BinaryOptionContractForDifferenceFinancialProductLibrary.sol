// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./ContractForDifferenceFinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Binary Option Contract For Difference Financial Product Library.
 * @notice Adds settlement logic to binary option CFDs. Binary options settle with all collateral allocated to
 * either the long or short side, depending on the settlement price. They can be used to make prediction markets or any
 * kind of binary bet. Settlement is defined using a strike price which informs which side of the bet was correct. If
 * settlement price is greater or equal to the strike then all value is sent to the long side. Otherwise, all value
 * is sent to the short side. The settlement price could be a scalar (like the price of ETH) or a binary bet with
 * settlement being 0 or 1 depending on the outcome.
 */
contract BinaryOptionContractForDifferenceFinancialProductLibrary is
    ContractForDifferenceFinancialProductLibrary,
    Lockable
{
    using FixedPoint for FixedPoint.Unsigned;
    using SafeMath for uint256;

    struct binaryContractForDifferenceParameters {
        bool isSet;
        int256 strikePrice;
    }

    mapping(address => binaryContractForDifferenceParameters) public contractForDifferenceParameters;

    /**
     * @notice Enables any address to set the strike price for an associated binary option.
     * @param contractForDifference address of the CFD.
     * @param strikePrice the strike price for the binary option.
     * @dev Note: a) Any address can set the initial strike price b) A strike can be 0.
     * c) A strike price can only be set once to prevent the deployer from changing the strike after the fact.
     * d) For safety, a strike price should be set before depositing any synthetic tokens in a liquidity pool.
     * e) financialProduct must expose an expirationTimestamp method to validate it is correctly deployed.
     */
    function setContractForDifferenceParameters(address contractForDifference, int256 strikePrice)
        public
        nonReentrant()
    {
        require(ExpiringContractInterface(contractForDifference).expirationTimestamp() != 0, "Invalid CFD address");
        require(!contractForDifferenceParameters[contractForDifference].isSet, "Parameters already set");

        contractForDifferenceParameters[contractForDifference] = binaryContractForDifferenceParameters({
            isSet: true,
            strikePrice: strikePrice
        });
    }

    /**
     * @notice Returns a number between 0 and 1 to indicate how much collateral each long and short token are entitled
     * to per collateralPerPair.
     * @param expiryPrice price from the optimistic oracle for the CFD price identifier.
     * @return expiryPercentLong to indicate how much collateral should be sent between long and short tokens.
     */
    function computeExpiryTokensForCollateral(int256 expiryPrice) public view override returns (uint256) {
        binaryContractForDifferenceParameters memory params = contractForDifferenceParameters[msg.sender];
        require(params.isSet, "Params not set for calling CFD");

        if (expiryPrice >= params.strikePrice) return FixedPoint.fromUnscaledUint(1).rawValue;
        else return FixedPoint.fromUnscaledUint(0).rawValue;
    }
}
