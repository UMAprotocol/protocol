// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Finder.sol";
import "./Governor.sol";
import "./Constants.sol";
import "./Voting.sol";
import "./AdminIdentifierLib.sol";
import "../../common/implementation/Lockable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Proposer contract that allows anyone to make governance proposals with a bond.
 */
contract Proposer is Ownable, Testable, Lockable {
    using SafeERC20 for IERC20;
    IERC20 public token;
    uint256 public bond;
    Governor public governor;
    Finder public finder;

    struct BondedProposal {
        address sender;
        // 64 bits to save a storage slot.
        uint64 time;
        uint256 lockedBond;
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
     * @param _timer the timer contract to control the output of getCurrentTime(). Set to 0x0 if in production.
     */
    constructor(
        IERC20 _token,
        uint256 _bond,
        Governor _governor,
        Finder _finder,
        address _timer
    ) Testable(_timer) {
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
     * @return id the id of the governor proposal.
     */
    function propose(Governor.Transaction[] memory transactions) external nonReentrant() returns (uint256 id) {
        id = governor.numProposals();
        token.safeTransferFrom(msg.sender, address(this), bond);
        bondedProposals[id] = BondedProposal({ sender: msg.sender, lockedBond: bond, time: uint64(getCurrentTime()) });
        governor.propose(transactions);
    }

    /**
     * @notice Resolves a proposal by checking the status of the request in the Voting contract.
     * @dev For the resolution to work correctly, this contract must be a registered contract in the DVM.
     * @param id proposal id.
     */
    function resolveProposal(uint256 id) external nonReentrant() {
        BondedProposal storage bondedProposal = bondedProposals[id];
        Voting voting = Voting(finder.getImplementationAddress(OracleInterfaces.Oracle));
        require(
            voting.hasPrice(AdminIdentifierLib._constructIdentifier(id), bondedProposal.time, ""),
            "No price resolved"
        );
        if (voting.getPrice(AdminIdentifierLib._constructIdentifier(id), bondedProposal.time, "") != 0) {
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
     * @dev Admin is intended to be the governance system, itself.
     * @param _bond the new bond.
     */
    function setBond(uint256 _bond) public nonReentrant() onlyOwner() {
        bond = _bond;
        emit BondSet(_bond);
    }
}
