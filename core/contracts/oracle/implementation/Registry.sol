pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/MultiRole.sol";
import "../interfaces/RegistryInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Registry for derivatives and approved derivative creators.
 * @dev Maintains a whitelist of derivative creators that are allowed to register new derivatives
 * and stores party members of a derivative.
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
    enum Validity { Invalid, Valid }

    // Store all key information about a derivative.
    struct Derivative {
        Validity valid;
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
    mapping(address => Derivative) public derivativeMap;

    // Map each party member to their associated derivatives struct.
    mapping(address => PartyMember) private partyMap;

    event NewDerivativeRegistered(address indexed derivativeAddress, address indexed creator, address[] parties);
    event PartyMemberAdded(address indexed derivativeAddress, address indexed party);
    event PartyMemberRemoved(address indexed derivativeAddress, address indexed party);

    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        // Start with no derivative creators registered.
        _createSharedRole(uint(Roles.DerivativeCreator), uint(Roles.Owner), new address[](0));
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function registerDerivative(address[] calldata parties, address derivativeAddress)
        external
        override
        onlyRoleHolder(uint(Roles.DerivativeCreator))
    {
        Derivative storage derivative = derivativeMap[derivativeAddress];
        require(derivativeMap[derivativeAddress].valid == Validity.Invalid, "Can only register once");

        // Store derivative address as a registered deriviative.
        registeredDerivatives.push(derivativeAddress);

        // No length check necessary because we should never hit (2^127 - 1) derivatives.
        derivative.index = uint128(registeredDerivatives.length.sub(1));

        // For all parties in the array add them to the derivative party members.
        // add the derivative as one of the party members own derivatives and store the index.
        derivative.valid = Validity.Valid;
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            partyMap[parties[i]].derivatives.push(derivativeAddress);
            uint newLength = partyMap[parties[i]].derivatives.length;
            partyMap[parties[i]].derivativeIndex[derivativeAddress] = newLength - 1;
        }

        emit NewDerivativeRegistered(derivativeAddress, msg.sender, parties);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isDerivativeRegistered(address derivative) external override view returns (bool) {
        return derivativeMap[derivative].valid == Validity.Valid;
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getRegisteredDerivatives(address party) external override view returns (address[] memory) {
        return partyMap[party].derivatives;
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function addPartyToDerivative(address party) external override {
        address derivativeAddress = msg.sender;

        require(derivativeMap[derivativeAddress].valid == Validity.Valid, "Can only add to valid derivative");
        require(!isPartyMemberOfDerivative(party, derivativeAddress), "Can only register a party once");

        // Push the derivative and store the index.
        partyMap[party].derivatives.push(derivativeAddress);
        uint derivativeIndex = partyMap[party].derivatives.length;
        partyMap[party].derivativeIndex[derivativeAddress] = derivativeIndex - 1;

        emit PartyMemberAdded(derivativeAddress, party);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function removePartyFromDerivative(address party) external override {
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

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getAllRegisteredDerivatives() external override view returns (address[] memory derivatives) {
        return registeredDerivatives;
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isPartyMemberOfDerivative(address party, address derivativeAddress) public override view returns (bool) {
        uint index = partyMap[party].derivativeIndex[derivativeAddress];
        return partyMap[party].derivatives.length > index && partyMap[party].derivatives[index] == derivativeAddress;
    }
}
