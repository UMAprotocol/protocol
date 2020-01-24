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
        mapping(address => bool) parties;
        uint128 index;
    }

    // Array of all derivatives that are approved to use the UMA Oracle.
    address[] public registeredDerivatives;

    // Map the address of the derivative contract to the associated derivative object.
    mapping(address => Derivative) public addressToDerivatives;

    // Map each party member to their associated derivatives.
    mapping(address => address[]) public partyMembersToDerivatives;

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

        registeredDerivatives.push(derivativeAddress);

        // No length check necessary because we should never hit (2^127 - 1) derivatives.
        derivative.index = uint128(registeredDerivatives.length.sub(1));

        derivative.valid = DerivativeValidity.Valid;
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            derivative.parties[parties[i]] = true;
            partyMembersToDerivatives[parties[i]].push(derivativeAddress);
        }

        emit NewDerivativeRegistered(derivativeAddress, msg.sender, parties);
    }

    function isDerivativeRegistered(address derivative) external view returns (bool) {
        return addressToDerivatives[derivative].valid == DerivativeValidity.Valid;
    }

    function getRegisteredDerivatives(address party) external view returns (address[] memory) {
        return partyMembersToDerivatives[party];
    }

    function addPartyToDerivative(address party) external {
        // Only a derivative calling can add a member to it's own party.
        address derivativeAddress = msg.sender;

        require(
            addressToDerivatives[derivativeAddress].valid == DerivativeValidity.Valid,
            "Can add to valid derivative"
        );
        require(addressToDerivatives[derivativeAddress].parties[party] == false, "Can only register a party once");

        addressToDerivatives[derivativeAddress].parties[party] = true;
        partyMembersToDerivatives[party].push(derivativeAddress);

        emit PartyMemberAdded(derivativeAddress, party);
    }

    function removedPartyFromDerivative(address party) external {
        address derivativeAddress = msg.sender;

        require(
            addressToDerivatives[derivativeAddress].valid == DerivativeValidity.Valid,
            "Remove only from valid derivative"
        );
        require(addressToDerivatives[derivativeAddress].parties[party] == true, "Remove existing party only");

        addressToDerivatives[derivativeAddress].parties[party] = false;

        // Need to delete the derivative from the partymembers array. This is vulnerable to a party member not being able
        // to remove a derivative from their array, if they have too many in their array and exceed gas limit.
        // However, this dos attack will not affect any party member other than the one who created too many.

        // Deleting works by looping through all derivatives the party member has in their array until the location is
        // found. This removed position is swapped with the final position in the array and then the array length
        // is shrunk by 1. This process does not preserve array order and does not keep blank positions.
        address[] storage partyArray = partyMembersToDerivatives[party];
        for (uint i = 0; i < partyArray.length; i.add(1)) {
            if (partyArray[i] == derivativeAddress) {
                partyArray[i] = partyArray[partyArray.length - 1];
                delete partyArray[partyArray.length - 1];
                partyArray.length--;
                break;
            }
        }

        emit PartyMemberRemoved(derivativeAddress, party);
    }

    function getAllRegisteredDerivatives() external view returns (address[] memory derivatives) {
        return registeredDerivatives;
    }

    function isPartyMemberOfDerivativeParty(address party, address derivative) external view returns (bool) {
        return addressToDerivatives[derivative].parties[party];
    }
}
