pragma solidity ^0.5.0;

import "./MultiRole.sol";
import "./RegistryInterface.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

pragma experimental ABIEncoderV2;


/**
 * @title Registry for derivatives and approved derivative creators.
 * @dev Maintains a whitelist of derivative creators that are allowed to register new derivatives.
 */
contract Registry is RegistryInterface, MultiRole {

    using SafeMath for uint;

    enum Roles {
        // The ultimate owner-type role that can change the writer.
        Governance,
        // Can add or remove DerivativeCreators.
        Writer,
        // Can register derivatives.
        DerivativeCreator
    }

    // Array of all registeredDerivatives that are approved to use the UMA Oracle.
    RegisteredDerivative[] private registeredDerivatives;

    // This enum is required because a WasValid state is required to ensure that derivatives cannot be re-registered.
    enum PointerValidity {
        Invalid,
        Valid
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

    // TODO(ptare): Used to make doubly sure that roles are initialized only once. Figure out what's going wrong with
    // coverage to necessitate this hack.
    bool private rolesInitialized;

    constructor() public {
        initializeRolesOnce();
    }

    function registerDerivative(address[] calldata parties, address derivativeAddress)
        external
        onlyRoleHolder(uint(Roles.DerivativeCreator))
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

        address[] memory partiesForEvent = parties;
        emit NewDerivativeRegistered(derivativeAddress, partiesForEvent);
    }

    function isDerivativeRegistered(address derivative) external view returns (bool isRegistered) {
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

    /*
     * @notice Do not call this function externally.
     * @dev Only called from the constructor, and only extracted to a separate method to make the coverage tool work.
     * Will revert if called again.
     */
    function initializeRolesOnce() public {
        require(!rolesInitialized, "Only the constructor should call this method");
        rolesInitialized = true;
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Writer), uint(Roles.Governance), msg.sender);
        // Start with no derivative creators registered.
        _createSharedRole(uint(Roles.DerivativeCreator), uint(Roles.Writer), new address[](0));
    }

    event NewDerivativeRegistered(address indexed derivativeAddress, address[] parties);
}
