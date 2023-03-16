// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./Finder.sol";
import "./GovernorV2.sol";
import "./Constants.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "./AdminIdentifierLib.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Proposer contract that allows anyone to make governance proposals with a bond.
 */
contract ProposerV2 is Ownable, Lockable, MultiCaller {
    using SafeERC20 for IERC20;
    IERC20 public immutable token; // The ERC20 token that the bond is paid in.
    uint256 public bond; // The bond amount for making a proposal.
    GovernorV2 public immutable governor; // The governor contract that this contract makes proposals to.
    Finder public immutable finder; // Finder contract that stores addresses of UMA system contracts.

    struct BondedProposal {
        address sender;
        // 64 bits to save a storage slot.
        uint64 time;
        uint256 lockedBond;
        bytes ancillaryData;
    }
    mapping(uint256 => BondedProposal) public bondedProposals;

    event BondSet(uint256 bond);
    event ProposalResolved(uint256 indexed id, bool success);

    /**
     * @notice Construct the Proposer contract.
     * @param _token the ERC20 token that the bond is paid in.
     * @param _bond the bond amount.
     * @param _governor the governor contract that this contract makes proposals to.
     * @param _finder the finder contract used to look up addresses.
     */
    constructor(
        IERC20 _token,
        uint256 _bond,
        GovernorV2 _governor,
        Finder _finder
    ) {
        token = _token;
        governor = _governor;
        finder = _finder;
        setBond(_bond);
        transferOwnership(address(_governor));
    }

    /**
     * @notice Propose a new set of governance transactions for vote.
     * @dev Pulls bond from the caller.
     * @param transactions list of transactions for the governor to execute.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @return id the id of the governor proposal.
     */
    function propose(GovernorV2.Transaction[] memory transactions, bytes memory ancillaryData)
        external
        nonReentrant()
        returns (uint256)
    {
        uint256 id = governor.numProposals();
        token.safeTransferFrom(msg.sender, address(this), bond);
        bondedProposals[id] = BondedProposal({
            sender: msg.sender,
            lockedBond: bond,
            time: uint64(getCurrentTime()),
            ancillaryData: ancillaryData
        });
        governor.propose(transactions, ancillaryData);
        return id;
    }

    /**
     * @notice Resolves a proposal by checking the status of the request in the Voting contract.
     * @dev For the resolution to work correctly, this contract must be a registered contract in the DVM.
     * @param id proposal id.
     */
    function resolveProposal(uint256 id) external nonReentrant() {
        BondedProposal memory bondedProposal = bondedProposals[id];
        require(bondedProposal.sender != address(0), "Invalid proposal id");
        OracleAncillaryInterface voting =
            OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
        bytes32 adminIdentifier = AdminIdentifierLib._constructIdentifier(id);

        require(
            voting.hasPrice(adminIdentifier, bondedProposal.time, bondedProposal.ancillaryData),
            "No price resolved"
        );
        if (voting.getPrice(adminIdentifier, bondedProposal.time, bondedProposal.ancillaryData) != 0) {
            token.safeTransfer(bondedProposal.sender, bondedProposal.lockedBond);
            emit ProposalResolved(id, true);
        } else {
            token.safeTransfer(finder.getImplementationAddress(OracleInterfaces.Store), bondedProposal.lockedBond);
            emit ProposalResolved(id, false);
        }
        delete bondedProposals[id];
    }

    /**
     * @notice Admin method to set the bond amount.
     * @dev Admin is intended to be the governance system itself.
     * @param _bond the new bond.
     */
    function setBond(uint256 _bond) public nonReentrant() onlyOwner() {
        bond = _bond;
        emit BondSet(_bond);
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     * @return the current block timestamp.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }
}
