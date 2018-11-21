pragma solidity >=0.4.24;

import "./Derivative.sol";
import "./TokenizedDerivative.sol";


contract Registry {
    mapping(address => address[]) private registeredContracts;
    address private oracleAddress;

    event Register(address indexed party, address indexed derivative);

    constructor(address _oracleAddress) public {
        oracleAddress = _oracleAddress;
    }

    function createDerivative(
        address counterparty,
        int256 defaultPenalty,
        int256 requiredMargin,
        uint expiry,
        string product,
        uint notional
    )
        external
        payable
        returns (address derivativeAddress)
    {

        // TODO: Think about which person is going to be creating the contract... Right now, we're assuming it comes
        //       from the taker. This is just for convenience
        SimpleDerivative derivative = (new SimpleDerivative).value(msg.value)(
            counterparty,
            msg.sender,
            oracleAddress,
            defaultPenalty,
            requiredMargin,
            expiry,
            product,
            notional
        );

        _register(msg.sender, address(derivative));
        _register(counterparty, address(derivative));

        return address(derivative);
    }

    function createTokenizedDerivative(
        address provider,
        address investor,
        uint defaultPenalty,
        uint providerRequiredMargin,
        string product,
        uint fixedYearlyFee,
        uint disputeDeposit
    )
        external
        returns (address derivativeAddress)
    {

        SimpleTokenizedDerivative derivative = new SimpleTokenizedDerivative(
            provider,
            investor,
            oracleAddress,
            defaultPenalty,
            providerRequiredMargin,
            product,
            fixedYearlyFee,
            disputeDeposit
        );

        _register(provider, address(derivative));
        _register(investor, address(derivative));

        return address(derivative);
    }

    function getNumRegisteredContractsBySender() external view returns (uint number) {
        return getNumRegisteredContracts(msg.sender);
    }

    function getRegisteredContractBySender(uint index) external view returns (address contractAddress) {
        return getRegisteredContract(index, msg.sender);
    }

    function getNumRegisteredContracts(address party) public view returns (uint number) {
        return registeredContracts[party].length;
    }

    function getRegisteredContract(uint index, address party) public view returns (address contractAddress) {
        return registeredContracts[party][index];
    }

    function _register(address party, address contractToRegister) internal {
        registeredContracts[party].push(contractToRegister);
        emit Register(party, contractToRegister);
    }
}
