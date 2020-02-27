pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../common/implementation/Testable.sol";
import "./AddressWhitelist.sol";
import "../oracle/implementation/ContractCreator.sol";
import "./TokenizedDerivative.sol";


/**
 * @title Contract creator for TokenizedDerivative.
 */
contract TokenizedDerivativeCreator is ContractCreator, Testable {
    struct Params {
        address priceFeedAddress;
        uint defaultPenalty; // Percentage of mergin requirement * 10^18
        uint supportedMove; // Expected percentage move in the underlying that the long is protected against.
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of mergin requirement * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of shortBalance * 10^18
        TokenizedDerivativeParams.ReturnType returnType;
        uint startingUnderlyingPrice;
        string name;
        string symbol;
    }

    AddressWhitelist public returnCalculatorWhitelist;
    AddressWhitelist public marginCurrencyWhitelist;

    event CreatedTokenizedDerivative(address contractAddress);

    constructor(
        address _finderAddress,
        address _returnCalculatorWhitelist,
        address _marginCurrencyWhitelist,
        bool _isTest
    ) public ContractCreator(_finderAddress) Testable(_isTest) {
        returnCalculatorWhitelist = AddressWhitelist(_returnCalculatorWhitelist);
        marginCurrencyWhitelist = AddressWhitelist(_marginCurrencyWhitelist);
    }

    /**
     * @notice Creates a new instance of `TokenizedDerivative` with the provided `params`.
     */
    function createTokenizedDerivative(Params memory params) public returns (address derivativeAddress) {
        TokenizedDerivative derivative = new TokenizedDerivative(_convertParams(params), params.name, params.symbol);

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedTokenizedDerivative(address(derivative));

        return address(derivative);
    }

    // Converts createTokenizedDerivative params to TokenizedDerivative constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (TokenizedDerivativeParams.ConstructorParams memory constructorParams)
    {
        // Copy and verify externally provided variables.
        constructorParams.sponsor = msg.sender;

        require(returnCalculatorWhitelist.isOnWhitelist(params.returnCalculator));
        constructorParams.returnCalculator = params.returnCalculator;

        require(marginCurrencyWhitelist.isOnWhitelist(params.marginCurrency));
        constructorParams.marginCurrency = params.marginCurrency;

        constructorParams.priceFeedAddress = params.priceFeedAddress;
        constructorParams.defaultPenalty = params.defaultPenalty;
        constructorParams.supportedMove = params.supportedMove;
        constructorParams.product = params.product;
        constructorParams.fixedYearlyFee = params.fixedYearlyFee;
        constructorParams.disputeDeposit = params.disputeDeposit;
        constructorParams.startingTokenPrice = params.startingTokenPrice;
        constructorParams.expiry = params.expiry;
        constructorParams.withdrawLimit = params.withdrawLimit;
        constructorParams.returnType = params.returnType;
        constructorParams.startingUnderlyingPrice = params.startingUnderlyingPrice;

        // Copy internal variables.
        constructorParams.finderAddress = finderAddress;
        constructorParams.creationTime = getCurrentTime();
    }
}
