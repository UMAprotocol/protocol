// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./Finder.sol";
import "./Governor.sol";
import "./Constants.sol";
import "./Voting.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title
 */
contract Proposer is Ownable {
    using SafeERC20 for IERC20;
    IERC20 public token;
    uint256 public bond;
    Governor public governor;
    Finder public finder;

    struct BondedProposal {
        address sender;
        uint256 lockedBond;
    }
    mapping(uint256 => BondedProposal) public bondedProposals;

    event BondSet(uint256 bond);
    event ProposalResolved(uint256 indexed id, bool success);

    /**
     * @notice Construct the Proposer contract.
     */
    constructor(
        IERC20 _token,
        uint256 _bond,
        Governor _governor,
        Finder _finder
    ) {
        token = _token;
        bond = _bond;
        governor = _governor;
        finder = _finder;
        emit BondSet(_bond);
    }

    function propose(Governor.Transaction[] memory transactions) public {
        require(transactions.length > 0);
        uint256 id = governor.numProposals();
        token.safeTransferFrom(msg.sender, address(this), bond);
        bondedProposals[id] = BondedProposal({ sender: msg.sender, lockedBond: bond });
        governor.propose(transactions);
    }

    function resolveProposal(uint256 id) external payable {
        require(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function setBond(uint256 _bond) public onlyOwner {
        bond = _bond;
        emit BondSet(_bond);
    }
}
