pragma solidity ^0.5.0;

import "./MultiRole.sol";
import "./RegistryInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

pragma experimental ABIEncoderV2;

/**
 * @title Registry for derivatives and approved derivative creators.
 * @dev Maintains a whitelist of derivative creators that are allowed to register new derivatives.
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

    // Map the address of the derivitive contract to the associated derivative object.
    mapping(address => Derivative) public addressToDerivatives;

    // Map each party member to their associated derivatives.
    mapping(address => address[]) public partyMembersToDerivatives;

    // Array of all derivatives that are approved to use the UMA Oracle.
    address[] public registeredDerivatives;

    event NewDerivativeRegistered(address indexed derivativeAddress, address indexed creator, address[] parties);

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

        address[] memory partiesForEvent = parties;
        emit NewDerivativeRegistered(derivativeAddress, msg.sender, partiesForEvent);

    }

    function isDerivativeRegistered(address derivative) external view returns (bool) {
        return addressToDerivatives[derivative].valid == DerivativeValidity.Valid;
    }

    function getRegisteredDerivatives(address party) external view returns (address[] memory) {
        return partyMembersToDerivatives[party];
    }

    function addPartyToDerivative(address party, address derivative) external onlyRoleHolder(uint(Roles.Owner)) {
        require(addressToDerivatives[derivative].valid == DerivativeValidity.Valid, "Can add to valid derivative");
        require(addressToDerivatives[derivative].parties[party] == false, "Can only register a party once");

        addressToDerivatives[derivative].parties[party] = true;
        partyMembersToDerivatives[party].push(derivative);
    }

    function removedPartyFromDerivative(address party, address derivative) external onlyRoleHolder(uint(Roles.Owner)) {
        require(addressToDerivatives[derivative].valid == DerivativeValidity.Valid, "Can remove from valid derivative");
        require(addressToDerivatives[derivative].parties[party] == true, "Can only remove an added party");

        addressToDerivatives[derivative].parties[party] = false;

        for (uint i = 0; i < partyMembersToDerivatives[party].length; i.add(1)) {
            if (partyMembersToDerivatives[party][i] == derivative) {
                delete partyMembersToDerivatives[derivative];
            }
        }
        partyMembersToDerivatives[party].push(derivative);
    }

    function getAllRegisteredDerivatives() external view returns (address[] memory derivatives) {
        return registeredDerivatives;
    }
}
