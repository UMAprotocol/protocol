pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "../../common/implementation/MultiRole.sol";
import "../interfaces/RegistryInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";


/**
 * @title Registry for financial contracts and approved financial contract creators.
 * @dev Maintains a whitelist of financial contract creators that are allowed
 * to register new financial contracts and stores party members of a financial contract.
 */
contract Registry is RegistryInterface, MultiRole {
    using SafeMath for uint;

    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles {
        Owner, // The owner manages the set of ContractCreators.
        ContractCreator // Can register financial contracts.
    }

    // This enum is required because a WasValid state is required to ensure that financial contracts cannot be re-registered.
    enum Validity { Invalid, Valid }

    // Local information about a contract.
    struct FinancialContract {
        Validity valid;
        uint128 index;
    }

    struct Party {
        address[] contracts; // Each financial contract address is stored in this array.
        // The index of each financial contract is mapped to it's address for constant time look up and deletion.
        mapping(address => uint) contractIndex;
    }

    // Array of all contracts that are approved to use the UMA Oracle.
    address[] public registeredContracts;

    // Map of financial contract contracts to the associated FinancialContract struct.
    mapping(address => FinancialContract) public contractMap;

    // Map each party member to their associated FinancialContract struct.
    mapping(address => Party) private partyMap;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewContractRegistered(address indexed contractAddress, address indexed creator, address[] parties);
    event PartyAdded(address indexed contractAddress, address indexed party);
    event PartyRemoved(address indexed contractAddress, address indexed party);

    /**
     * @notice Construct the Registry contract.
     */
    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        // Start with no contract creators registered.
        _createSharedRole(uint(Roles.ContractCreator), uint(Roles.Owner), new address[](0));
    }

    /****************************************
     *        REGISTRATION FUNCTIONS        *
     ****************************************/

    /**
     * @notice Registers a new financial contract.
     * @dev Only authorized contract creators can call this method.
     * @param parties an array of addresses who become parties in the contract.
     * @param contractAddress defines the address of the deployed finan.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function registerContract(address[] calldata parties, address contractAddress)
        external
        override
        onlyRoleHolder(uint(Roles.ContractCreator))
    {
        FinancialContract storage financialContract = contractMap[contractAddress];
        require(contractMap[contractAddress].valid == Validity.Invalid, "Can only register once");

        // Store contract address as a registered contract.
        registeredContracts.push(contractAddress);

        // No length check necessary because we should never hit (2^127 - 1) contracts.
        financialContract.index = uint128(registeredContracts.length.sub(1));

        // For all parties in the array add them to the contract's parties.
        financialContract.valid = Validity.Valid;
        for (uint i = 0; i < parties.length; i = i.add(1)) {
            partyMap[parties[i]].contracts.push(contractAddress);
            uint newLength = partyMap[parties[i]].contracts.length;
            partyMap[parties[i]].contractIndex[contractAddress] = newLength - 1;
        }

        emit NewContractRegistered(contractAddress, msg.sender, parties);
    }

    /**
     * @notice Adds a party member to the calling contract.
     * @dev msg.sender will be used to determine the contract that this party is added to.
     * @param party new party for the calling contract.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function addPartyToContract(address party) external override {
        address contractAddress = msg.sender;

        require(contractMap[contractAddress].valid == Validity.Valid, "Can only add to valid contract");
        require(!isPartyMemberOfContract(party, contractAddress), "Can only register a party once");

        // Push the contract address and store the index.
        uint contractIndex = partyMap[party].contracts.length;
        partyMap[party].contracts.push(contractAddress);
        partyMap[party].contractIndex[contractAddress] = contractIndex;

        emit PartyAdded(contractAddress, party);
    }

    /**
     * @notice Removes a party member to the calling contract.
     * @dev msg.sender will be used to determine the contract that this party is removed from.
     * @param partyAddress address to be removed from the calling contract.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function removePartyFromContract(address partyAddress) external override {
        address contractAddress = msg.sender;
        Party storage party = partyMap[partyAddress];
        uint256 numberOfContracts = party.contracts.length;

        require(numberOfContracts != 0, "Can't remove if party has no contracts");
        require(contractMap[contractAddress].valid == Validity.Valid, "Remove only from valid contract");
        require(isPartyMemberOfContract(partyAddress, contractAddress), "Can only remove an existing party");

        // Index of the current location of the contract to remove.
        uint deleteIndex = party.contractIndex[contractAddress];

        // Store the last contract's address to update the lookup map.
        address lastContractAddress = party.contracts[numberOfContracts - 1];

        // Swap the contract to be removed with the last contract.
        party.contracts[deleteIndex] = lastContractAddress;

        // Update the lookup index with the new location.
        party.contractIndex[lastContractAddress] = deleteIndex;

        // Pop the last contract from the array and update the lookup map.
        party.contracts.pop();
        delete party.contractIndex[contractAddress];

        emit PartyRemoved(contractAddress, partyAddress);
    }

    /****************************************
     *         REGISTRY STATE GETTERS       *
     ****************************************/

    /**
     * @notice Returns whether the contract has been registered with the registry.
     * @dev If it is registered, it is an authorized participant in the UMA system.
     * @param contractAddress address of the financial contract.
     * @return bool indicates whether the contract is registered.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isContractRegistered(address contractAddress) external override view returns (bool) {
        return contractMap[contractAddress].valid == Validity.Valid;
    }

    /**
     * @notice Returns a list of all contracts that are associated with a particular party.
     * @param party address of the party.
     * @return an array of the contracts the party is registered to.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getRegisteredContracts(address party) external override view returns (address[] memory) {
        return partyMap[party].contracts;
    }

    /**
     * @notice Returns all registered contracts.
     * @return all registered contract addresses within the system.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getAllRegisteredContracts() external override view returns (address[] memory) {
        return registeredContracts;
    }

    /**
     * @notice checks if an address is a party of a contract.
     * @param party party to check.
     * @param contractAddress address to check against the party.
     * @return bool indicating if the address is a party of the contract.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function isPartyMemberOfContract(address party, address contractAddress) public override view returns (bool) {
        uint index = partyMap[party].contractIndex[contractAddress];
        return partyMap[party].contracts.length > index && partyMap[party].contracts[index] == contractAddress;
    }
}
