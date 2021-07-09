// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;
import "./FinancialProductLibrary.sol";
import "../../../../common/implementation/Lockable.sol";

/**
 * @title Pre-Expiration Identifier Transformation Financial Product Library
 * @notice Adds custom identifier transformation to enable a financial contract to use two different identifiers, depending
 * on when a price request is made. If the request is made before expiration then a transformation is made to the identifier
 * & if it is at or after expiration then the original identifier is returned. This library enables self referential
 * TWAP identifier to be used on synthetics pre-expiration, in conjunction with a separate identifier at expiration.
 */
contract PreExpirationIdentifierTransformationFinancialProductLibrary is FinancialProductLibrary, Lockable {
    mapping(address => bytes32) financialProductTransformedIdentifiers;

    /**
     * @notice Enables the deployer of the library to set the transformed identifier for an associated financial product.
     * @param financialProduct address of the financial product.
     * @param transformedIdentifier the identifier for the financial product to be used if the contract is pre expiration.
     * @dev Note: a) Any address can set identifier transformations b) The identifier can't be set to blank. c) A
     * transformed price can only be set once to prevent the deployer from changing it after the fact. d) financialProduct
     * must expose an expirationTimestamp method.
     */
    function setFinancialProductTransformedIdentifier(address financialProduct, bytes32 transformedIdentifier)
        public
        nonReentrant()
    {
        require(transformedIdentifier != "", "Cant set to empty transformation");
        require(financialProductTransformedIdentifiers[financialProduct] == "", "Transformation already set");
        require(ExpiringContractInterface(financialProduct).expirationTimestamp() != 0, "Invalid EMP contract");
        financialProductTransformedIdentifiers[financialProduct] = transformedIdentifier;
    }

    /**
     * @notice Returns the transformed identifier associated with a given financial product address.
     * @param financialProduct address of the financial product.
     * @return transformed identifier for the associated financial product.
     */
    function getTransformedIdentifierForFinancialProduct(address financialProduct)
        public
        view
        nonReentrantView()
        returns (bytes32)
    {
        return financialProductTransformedIdentifiers[financialProduct];
    }

    /**
     * @notice Returns a transformed price identifier if the contract is pre-expiration and no transformation if post.
     * @param identifier input price identifier to be transformed.
     * @param requestTime timestamp the identifier is to be used at.
     * @return transformedPriceIdentifier the input price identifier with the transformation logic applied to it.
     */
    function transformPriceIdentifier(bytes32 identifier, uint256 requestTime)
        public
        view
        override
        nonReentrantView()
        returns (bytes32)
    {
        require(financialProductTransformedIdentifiers[msg.sender] != "", "Caller has no transformation");
        // If the request time is before contract expiration then return the transformed identifier. Else, return the
        // original price identifier.
        if (requestTime < ExpiringContractInterface(msg.sender).expirationTimestamp()) {
            return financialProductTransformedIdentifiers[msg.sender];
        } else {
            return identifier;
        }
    }
}
