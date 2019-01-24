pragma solidity ^0.5.0;

import "./RegistryInterface.sol";

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

pragma experimental ABIEncoderV2;


contract Registry is RegistryInterface, Ownable {

    using SafeMath for uint;

    // Array of all registeredDerivatives that are approved to use the UMA Oracle.
    RegisteredDerivative[] private registeredDerivatives;

    // This enum is required because a WasValid state is required to ensure that derivatives cannot be re-registered.
    enum PointerValidity {
        Invalid,
        Valid,
        WasValid
    }

    struct Pointer {
        PointerValidity valid;
        uint128 index;
    }

    // Maps from derivative address to a pointer that refers to that RegisteredDerivative in registeredDerivatives.
    mapping(address => Pointer) private derivativePointers; 

    // Note: this must be stored outside of the RegisteredDerivative because mappings cannot be deleted and copied
    // like normal data. This could be stored in the Pointer struct, but storing it there would muddy the purpose
    // of the Pointer struct and break separation of concern between referential data and data.
    struct PartiesMap {
        mapping(address => bool) parties;
    }

    // Maps from derivative address to the set of parties that are involved in that derivative.
    mapping(address => PartiesMap) private derivativesToParties;

    // Maps from derivative creator address to whether that derivative creator has been approved to register contracts.
    mapping(address => bool) private derivativeCreators;

    modifier onlyApprovedDerivativeCreator {
        require(derivativeCreators[msg.sender]);
        _;
    }

    function registerDerivative(address[] calldata parties, address derivativeAddress)
        external
        onlyApprovedDerivativeCreator
    {
        // Create derivative pointer.
        Pointer storage pointer = derivativePointers[derivativeAddress];

        // Ensure that the pointer was not valid in the past (derivatives cannot be re-registered or double
        // registered).
        require(pointer.valid == PointerValidity.Invalid);
        pointer.valid = PointerValidity.Valid;

        registeredDerivatives.push(RegisteredDerivative(derivativeAddress, msg.sender));
        
        // No length check necessary because we should never hit (2^127 - 1) derivatives.
        pointer.index = uint128(registeredDerivatives.length.sub(1));

        // Set up PartiesMap for this derivative.
        PartiesMap storage partiesMap = derivativesToParties[derivativeAddress];
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            partiesMap.parties[parties[i]] = true;
        }
    }

    function addDerivativeCreator(address derivativeCreator) external onlyOwner {
        derivativeCreators[derivativeCreator] = true;
    }

    function removeDerivativeCreator(address derivativeCreator) external onlyOwner {
        derivativeCreators[derivativeCreator] = false;
    }

    function unregisterDerivative(address derivativeAddress) external {
        // Grab the pointer for the derivative being unregistered.
        Pointer storage pointer = derivativePointers[derivativeAddress];

        // Ensure the derivative is registered before taking any action.
        require(pointer.valid == PointerValidity.Valid);
        uint128 index = pointer.index;

        // Only the owner, the derivative, or the original creator of the derivative can remove it from the registry.
        require(msg.sender == owner() || msg.sender == derivativeAddress
            || (derivativeCreators[msg.sender] && (msg.sender == registeredDerivatives[index].derivativeCreator)));

        // Set the unregistered derivative's slot in the array to the data in the last slot.
        RegisteredDerivative storage slotToSwap = registeredDerivatives[index];
        uint newLength = registeredDerivatives.length.sub(1);
        slotToSwap = registeredDerivatives[newLength];

        // Move the swapped derivative's pointer to its new index.
        derivativePointers[slotToSwap.derivativeAddress].index = index;

        // Remove the last element in the array.
        registeredDerivatives.length = newLength;

        // Remove pointer.
        pointer.index = 0;
        pointer.valid = PointerValidity.WasValid;

        // Delete the party mapping.
        delete derivativesToParties[derivativeAddress];
    }

    function isDerivativeRegistered(address derivative) external view returns (bool isRegistred) {
        return derivativePointers[derivative].valid == PointerValidity.Valid;
    }

    function getRegisteredDerivatives(address party) external view returns (RegisteredDerivative[] memory derivatives) {
        // This is not ideal - we must statically allocate memory arrays. To be safe, we make a temporary array as long
        // as registeredDerivatives. We populate it with any derivatives that involve the provided party. Then, we copy
        // the array over to the return array, which is allocated using the correct size. Note: this is done by double
        // copying each value rather than storing some referential info (like indices) in memory to reduce the number
        // of storage reads. This is because storage reads are far more expensive than extra memory space (~100:1).
        RegisteredDerivative[] memory tmpDerivativeArray = new RegisteredDerivative[](registeredDerivatives.length);
        uint outputIndex = 0;
        for (uint i = 0; i < registeredDerivatives.length; i = i.add(1)) {
            RegisteredDerivative storage derivative = registeredDerivatives[i];
            if (derivativesToParties[derivative.derivativeAddress].parties[party]) {
                // Copy selected derivative to the temporary array.
                tmpDerivativeArray[outputIndex] = derivative;
                outputIndex = outputIndex.add(1);
            }
        }

        // Copy the temp array to the return array that is set to the correct size.
        derivatives = new RegisteredDerivative[](outputIndex);
        for (uint j = 0; j < outputIndex; j = j.add(1)) {
            derivatives[j] = tmpDerivativeArray[j];
        }
    }

    function getAllRegisteredDerivatives() external view returns (RegisteredDerivative[] memory derivatives) {
        return registeredDerivatives;
    }

    function isDerivativeCreatorAuthorized(address derivativeCreator) external view returns (bool isAuthorized) {
        return derivativeCreators[derivativeCreator];
    }
}
