pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "../../common/MultiRole.sol";
import "../interfaces/RegistryInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Registry for derivatives and approved derivative creators.
 * @dev Maintains a whitelist of derivative creators that are allowed
 * to register new derivatives and stores party members of a derivative.
 */
contract Registry is RegistryInterface, MultiRole {
    using SafeMath for uint;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles {
        Owner, // The owner manages the set of DerivativeCreators.
        DerivativeCreator // Can register derivatives.
    }

    // This enum is required because a WasValid state is required to ensure that derivatives cannot be re-registered.
    enum Validity { Invalid, Valid }

    // Store all key information about a derivative.
    struct Derivative {
        Validity valid;
        uint128 index;
    }

    struct PartyMember {
        address[] derivatives; // Each derivative address is stored in this array.
        // The index of each derivative is mapped to it's address for constant time look up and deletion.
        mapping(address => uint) derivativeIndex;
    }

    // Array of all derivatives that are approved to use the UMA Oracle.
    address[] public registeredDerivatives;

    // Map of derivative contracts to the associated derivative struct.
    mapping(address => Derivative) public derivativeMap;

    // Map each party member to their associated derivatives struct.
    mapping(address => PartyMember) private partyMap;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewDerivativeRegistered(address indexed derivativeAddress, address indexed creator, address[] parties);
    event PartyMemberAdded(address indexed derivativeAddress, address indexed party);
    event PartyMemberRemoved(address indexed derivativeAddress, address indexed party);

    /**
     * @notice Construct the Registry contract.
     */
    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        // Start with no derivative creators registered.
        _createSharedRole(uint(Roles.DerivativeCreator), uint(Roles.Owner), new address[](0));
    }

    /****************************************
     *        REGISTRATION FUNCTIONS        *
     ****************************************/

    /**
     * @notice Registers a new derivative.
     * @dev Only authorized derivative creators can call this method.
     * @param parties is an array of addresses who become party members to a derivative.
     * @param derivativeAddress defines the address of the deployed derivative.
     */
    function registerDerivative(address[] calldata parties, address derivativeAddress)
        external
        onlyRoleHolder(uint(Roles.DerivativeCreator))
    {
        Derivative storage derivative = derivativeMap[derivativeAddress];
        require(derivativeMap[derivativeAddress].valid == Validity.Invalid, "Can only register once");

        // Store derivative address as a registered derivative.
        registeredDerivatives.push(derivativeAddress);

        // No length check necessary because we should never hit (2^127 - 1) derivatives.
        derivative.index = uint128(registeredDerivatives.length.sub(1));

        // For all parties in the array add them to the derivative party members.
        // Add the derivative as one of the party members own derivatives and store the index.
        derivative.valid = Validity.Valid;
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            uint newLength = partyMap[parties[i]].derivatives.push(derivativeAddress);
            partyMap[parties[i]].derivativeIndex[derivativeAddress] = newLength - 1;
        }

        emit NewDerivativeRegistered(derivativeAddress, msg.sender, parties);
    }

    /**
     * @notice Adds a party member to the calling derivative.
     * @dev msg.sender must be the derivative contract to which the party member is added.
     * @param party defines the address to be added to the derivatives.
     */
    function addPartyToDerivative(address party) external {
        address derivativeAddress = msg.sender;

        require(derivativeMap[derivativeAddress].valid == Validity.Valid, "Can only add to valid derivative");
        require(!isPartyMemberOfDerivative(party, derivativeAddress), "Can only register a party once");

        // Push the derivative and store the index.
        uint derivativeIndex = partyMap[party].derivatives.push(derivativeAddress);
        partyMap[party].derivativeIndex[derivativeAddress] = derivativeIndex - 1;

        emit PartyMemberAdded(derivativeAddress, party);
    }

    /**
     * @notice Removes a party member to the calling derivative.
     * @dev msg.sender must be the derivative contract to which the party member is added.
     * @param party defines the address to be removed to the derivatives.
     */
    function removePartyFromDerivative(address party) external {
        address derivativeAddress = msg.sender;
        PartyMember storage partyMember = partyMap[party];
        uint256 numberOfDerivatives = partyMember.derivatives.length;

        require(numberOfDerivatives != 0, "Can't remove if party has no derivatives");
        require(derivativeMap[derivativeAddress].valid == Validity.Valid, "Remove only from valid derivative");
        require(isPartyMemberOfDerivative(party, derivativeAddress), "Can only remove an existing party member");

        // Index of the current location of the derivative to remove.
        uint deleteIndex = partyMember.derivativeIndex[derivativeAddress];

        // Store the last derivative's address to update the lookup map.
        address lastDerivativeAddress = partyMember.derivatives[numberOfDerivatives - 1];

        // Swap the derivative to be removed with the last derivative.
        partyMember.derivatives[deleteIndex] = lastDerivativeAddress;

        // Update the lookup index with the new location.
        partyMember.derivativeIndex[lastDerivativeAddress] = deleteIndex;

        // Pop the last derivative from the array and update the lookup map.
        partyMember.derivatives.pop();
        delete partyMember.derivativeIndex[derivativeAddress];

        emit PartyMemberRemoved(derivativeAddress, party);
    }

    /****************************************
     *         REGISTRY STATE GETTERS       *
     ****************************************/

    /**
     * @notice Returns whether the derivative has been registered with the registry.
     * @dev If registered is therefore an authorized participant in the UMA system.
     * @param derivative address of the derivative contract.
     * @return bool indicating if the derivative is registered.
     */
    function isDerivativeRegistered(address derivative) external view returns (bool) {
        return derivativeMap[derivative].valid == Validity.Valid;
    }

    /**
     * @notice Returns a list of all derivatives that are associated with a particular party.
     * @param party address of the party member.
     * @return an array of addresses of all the derivatives the party member is registered to.
     */
    function getRegisteredDerivatives(address party) external view returns (address[] memory) {
        return partyMap[party].derivatives;
    }

    /**
     * @notice Returns all registered derivatives.
     * @return all registered derivative addresses within the system.
     */
    function getAllRegisteredDerivatives() external view returns (address[] memory) {
        return registeredDerivatives;
    }

    /**
     * @notice checks if a party member is part of a derivative.
     * @param party party member to check.
     * @param derivativeAddress address to check against the party member.
     * @return bool indicating if the address member is party of the derivative party.
     */
    function isPartyMemberOfDerivative(address party, address derivativeAddress) public view returns (bool) {
        uint index = partyMap[party].derivativeIndex[derivativeAddress];
        return partyMap[party].derivatives.length > index && partyMap[party].derivatives[index] == derivativeAddress;
    }
}
