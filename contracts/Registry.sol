pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

pragma experimental ABIEncoderV2;


contract Registry is Ownable {

    using SafeMath for uint;

    struct RegisteredDerivative {
        address derivativeAddress;
        address contractCreator;
    }

    struct Pointer {
        bool valid;
        uint128 index;
        mapping(address => bool) parties;
    }

    mapping(address => bool) private derivativeCreators;
    mapping(address => Pointer) private derivativePointers;
    RegisteredDerivative[] private registeredDerivatives;

    modifier onlyApprovedDerivativeCreator {
        require(derivativeCreators[msg.sender]);
        _;
    }
    function isDerivativeRegistered(address derivative) external view returns (bool isRegistred) {
        return derivativePointers[derivative].valid;
    }

    function getRegisteredDerivatives(address party) external view returns (RegisteredDerivative[] memory derivatives) {
        derivatives = new RegisteredDerivative[](registeredDerivatives.length);
        for (uint i = 0; i < registeredDerivatives.length; i = i.add(1)) {
            RegisteredDerivative storage derivative = registeredDerivatives[i];
            if (derivativePointers[derivative.derivativeAddress].parties[party]) {
                derivatives[i] = derivative;
            }
        }
    }

    function getAllRegisteredDerivatives() external view returns (RegisteredDerivative[] memory derivatives) {
        return registeredDerivatives;
    }

    function isDerivativeCreatorAuthorized(address derivativeCreator) external view returns (bool isAuthorized) {
        return derivativeCreators[derivativeCreator];
    }

    function registerDerivative(address[] calldata counterparties, address derivativeAddress) external onlyApprovedDerivativeCreator {
        registeredDerivatives.push(RegisteredDerivative(derivativeAddress, msg.sender));
        // No length check necessary because we should never hit that many derivatives.
        uint128 idx = uint128(registeredDerivatives.length.sub(1));
        Pointer storage pointer = derivativePointers[derivativeAddress] = Pointer(true, idx);
        pointer.valid = true;
        pointer.index = idx;
        for (uint i = 0; i < counterparties.length; i = i.add(1)) {
            pointer.parties[counterparties[i]] = true;
        }
    }

    function addDerivativeCreator(address derivativeCreator) external onlyOwner {
        derivativeCreators[derivativeCreator] = true;
    }

    function removeDerivativeCreator(address derivativeCreator) external onlyOwner {
        derivativeCreators[derivativeCreator] = false;
    }

    function unregisterDerivative(address derivativeAddress) external {
        require(msg.sender == owner() || msg.sender == derivativeAddress);
        Pointer storage pointer = derivativePointers[derivativeAddress];
        require(pointer.valid);
        RegisteredDerivative storage slotToSwap = registeredDerivatives[pointer.index];
        uint newLength = registeredDerivatives.length.sub(1);
        slotToSwap = registeredDerivatives[newLength];
        registeredDerivatives.length = newLength;
        delete derivativePointers[derivativeAddress];
    }
}
