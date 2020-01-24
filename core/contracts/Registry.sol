pragma solidity ^0.5.0;

import "./MultiRole.sol";
import "./RegistryInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

pragma experimental ABIEncoderV2;

/**
 * @title Registry for derivatives and approved derivative creators.
 * @dev Maintains a whitelist of derivative creators that are allowed to register new derivatives
 * and stores party memebers of a derivative.
 */
contract Registry is RegistryInterface, MultiRole {
    using SafeMath for uint;

    enum Roles {
        // The owner manages the set of DerivativeCreators.
        Owner,
        // Can register derivatives.
        DerivativeCreator
    }

    // This enum is required because a WasValid state is required to ensure that derivatives cannot be re-registered.
    enum DerivativeValidity { Invalid, Valid }

    // Store all key information about a derivative.
    struct Derivative {
        DerivativeValidity valid;
        uint128 index;
    }

    struct PartyMember {
        // Each derivative address is stored in this array.
        address[] derivatives; 
        // The index of each derivative is mapped to it's address for constant time look up and deletion.
        mapping(address => uint) derivativeIndex; 
    }

    // Array of all derivatives that are approved to use the UMA Oracle.
    address[] public registeredDerivatives;

    // Map of derivative contracts to the associated derivative struct.
    mapping(address => Derivative) public addressToDerivatives;

    // Map each party member to their associated derivatives struct.
    mapping(address => PartyMember) private partyMembersToDerivatives;

    event NewDerivativeRegistered(address indexed derivativeAddress, address indexed creator, address[] parties);
    event PartyMemberAdded(address indexed derivativeAddress, address indexed party);
    event PartyMemberRemoved(address indexed derivativeAddress, address indexed party);

    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        // Start with no derivative creators registered.
        _createSharedRole(uint(Roles.DerivativeCreator), uint(Roles.Owner), new address[](0));
    }

    function registerDerivative(address[] calldata parties, address derivativeAddress)
        external
        onlyRoleHolder(uint(Roles.DerivativeCreator))
    {
        Derivative storage derivative = addressToDerivatives[derivativeAddress];
        require(addressToDerivatives[derivativeAddress].valid == DerivativeValidity.Invalid, "Can only register once");

        // Store derivative address as a registered deriviative.
        registeredDerivatives.push(derivativeAddress);

        // No length check necessary because we should never hit (2^127 - 1) derivatives.
        derivative.index = uint128(registeredDerivatives.length.sub(1));

        // For all parties in the array add them to the derivative party members.
        // add the derivative as one of the party members own derivatives and store the index.
        derivative.valid = DerivativeValidity.Valid;
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            uint derivativeIndex = partyMembersToDerivatives[parties[i]].derivatives.push(derivativeAddress);
            partyMembersToDerivatives[parties[i]].derivativeIndex[derivativeAddress] = derivativeIndex - 1;
        }

        emit NewDerivativeRegistered(derivativeAddress, msg.sender, parties);
    }

    function isDerivativeRegistered(address derivative) external view returns (bool) {
        return addressToDerivatives[derivative].valid == DerivativeValidity.Valid;
    }

    function getRegisteredDerivatives(address party) external view returns (address[] memory) {
        return partyMembersToDerivatives[party].derivatives;
    }

    function addPartyToDerivative(address party) external {
        address derivativeAddress = msg.sender;

        require(
            addressToDerivatives[derivativeAddress].valid == DerivativeValidity.Valid,
            "Can add to valid derivative"
        );
        require(!isPartyMemberOfDerivative(party, derivativeAddress), "Can only register a party once");

        // Push the derivative and store the index.
        uint derivativeIndex = partyMembersToDerivatives[party].derivatives.push(derivativeAddress);
        partyMembersToDerivatives[party].derivativeIndex[derivativeAddress] = derivativeIndex - 1;

        emit PartyMemberAdded(derivativeAddress, party);
    }

    function removePartyFromDerivative(address party) external {
        address derivativeAddress = msg.sender;

        PartyMember storage partyMember = partyMembersToDerivatives[party];

        require(
            addressToDerivatives[derivativeAddress].valid == DerivativeValidity.Valid,
            "Remove only from valid derivative"
        );
        require(isPartyMemberOfDerivative(party, derivativeAddress), "Can only register a party once");

        // Index of the current location of the derivative to remove.
        uint deleteIndex = partyMember.derivativeIndex[derivativeAddress];

        // Set the removed derivative address in the lookup map to 0 (deleted).
        partyMember.derivativeIndex[derivativeAddress] = 0;

        uint256 numberOfDerivatives = partyMember.derivatives.length;
        require(numberOfDerivatives != 0, "Can't remove if party has no derivatives");

        // If there is more than one derivative then swap the derivative to be removed with the
        // last position in the array and delete the last position.
        if (numberOfDerivatives > 1) {
            // Store the last derivative's address to update the lookup map.
            address lastDerivativeAddress = partyMember.derivatives[numberOfDerivatives - 1];

            // Swap the derivative to be removed with the last derivative.
            partyMember.derivatives[deleteIndex] = lastDerivativeAddress;

            // Delete the derivative from the array and shrink it's length.
            delete partyMember.derivatives[numberOfDerivatives - 1];
            partyMember.derivatives.length--;

            // Update the lookup index with the new location.
            partyMember.derivativeIndex[lastDerivativeAddress] = deleteIndex;
        // If there is only one derivative we simply need to delete it and set the index to zero.
        } else {
            delete partyMember.derivatives[numberOfDerivatives - 1];
            partyMember.derivatives.length--;
            partyMember.derivativeIndex[derivativeAddress] = 0;
        }

        emit PartyMemberRemoved(derivativeAddress, party);
    }

    function getAllRegisteredDerivatives() external view returns (address[] memory derivatives) {
        return registeredDerivatives;
    }

    function isPartyMemberOfDerivative(address party, address derivativeAddress) public view returns (bool) {
        uint index = partyMembersToDerivatives[party].derivativeIndex[derivativeAddress];
        return
            partyMembersToDerivatives[party].derivatives.length > index &&
            partyMembersToDerivatives[party].derivatives[index] == derivativeAddress;
    }
}
