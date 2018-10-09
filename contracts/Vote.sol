/*
  VoteCoin implementation

  Implements an early version of VoteCoin protocols

  * ERC20 token
  * Uses Oraclize to fetch ETH/USD exchange rate
  * Allows users to vote yes/no on whether a price is accurate

*/
pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
// import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "./Derivative.sol";


contract VoteCoin is ERC20 {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    struct DerivativeContract {
        address owner;
        address counterparty;
        uint contractId;
    }

    struct VoteYesNo {
        address[] voters;
        mapping(address => uint) votedFor;
        uint winner;
        bool voteTallied;
        uint startTime;
        uint endTime;
    }

    // Event information to facilitate communication with web interface
    event LogConstructorInitiated(string nextStep);
    event LogNewOraclizeQuery(string description);
    event LogPriceUpdated(string price);
    event NewDerivativeCreated(address maker, address taker);
    event VoteCreated(uint _voteID);
    event VoterChangedVote(address _voter, uint _proposal);
    event VoteTallied(uint _voteID, uint _winningProposal, uint winningTally);
    event VoterVoted(address _voter, uint _proposal);

    // Meta information about tokens
    string public name = "TestVoteCoin";
    string public symbol = "TVC";

    // Information used for votes
    uint public currVoteId;
    uint public voteDuration;
    mapping(uint => VoteYesNo) public allVotes;

    // Price info
    string public ethUsd = "0";

    // Derivative Market attached to VoteCoin for now -- Could be separated
    // into its own type, but this is easy for now
    // DerivativeContract[] allDerivatives = new DerivativeContract[](0);
    // For development
    // address constant public OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);
    constructor() public payable {
        voteDuration = 120;

        _mint(msg.sender, 10000);

        currVoteId = 0;
        newVote();
        // updatePrice();

        emit LogConstructorInitiated("Constructor was initiated. Call 'updatePrice()' to send the Oraclize Query.");
    }

    function vote(uint _voteID, uint _proposal) external {
        _vote(msg.sender, _voteID, _proposal);
    }

    //
    // Methods for retrieving price and checking whether verified
    //
    function __callback(bytes32, string result) public {
        // if (msg.sender != oraclize_cbAddress()) revert();

        // Tally old vote
        tallyVote(currVoteId);

        // Here we could issue rewards for having voting with majority

        // Price arrives
        ethUsd = result;
        emit LogPriceUpdated(ethUsd);

        // Create new vote
        newVote();

        updatePrice();
    }

    function updatePrice() public payable {
        // if (oraclize_getPrice("URL") > address(this).balance) {
        //     emit LogNewOraclizeQuery("Oraclize query was NOT sent, please add some ETH to cover for the query fee");
        // } else {
        //     emit LogNewOraclizeQuery("Oraclize query was sent, standing by for the answer..");
        //     // Waits `voteDuration` and then sends query
        //     oraclize_query(voteDuration, "URL", "json(https://api.gdax.com/products/ETH-USD/ticker).price");
        // }
    }

    //
    // Methods related to voting
    //
    function _vote(address _voter, uint _voteID, uint _proposal) internal {

        // TODO (REMOVE LATER) -- For now just issue tokens when someone votes
        if (balanceOf(_voter) < 1) {
            _mint(_voter, 1000);
        }

        // This will never happen
        require(balanceOf(_voter) > 0, "Not enough tokens to vote");
        require(_proposal < 3 && _proposal > 0, "Only can vote yes (2) or no (1)");

        VoteYesNo storage currentVote = allVotes[_voteID];
        require(currentVote.voteTallied == false);

        bool alreadyVoted = currentVote.votedFor[_voter] != 0;

        // Set address vote to _proposal
        currentVote.votedFor[_voter] = _proposal;

        // If this is first time, add them to voters array
        if (alreadyVoted) {
            emit VoterChangedVote(_voter, _proposal);
        } else {
            currentVote.voters.push(_voter);
            emit VoterVoted(_voter, _proposal);
        }
    }

    function determineWinner(uint _voteId) internal view returns (uint winningProposal) {
        uint voted2 = 0;
        VoteYesNo storage currentVote = allVotes[_voteId];
        uint nVoters = currentVote.voters.length;

        // Declare variables used later
        address currVoter;
        uint currProposalVote;
        uint currWeight;
        uint totalWeight;
        for (uint i=0; i < nVoters; i++) {
            currVoter = currentVote.voters[i];
            currProposalVote = currentVote.votedFor[currVoter];
            currWeight = balanceOf(currVoter);
            totalWeight = totalWeight + currWeight;
            if (currProposalVote == 2) {
                voted2 = voted2.add(currWeight);
            }
        }

        winningProposal = totalWeight.sub(voted2) < voted2 ? 2 : 1;
    }

    function newVote() private {
        currVoteId = currVoteId.add(1);

        uint currentTime = now; // solhint-disable-line not-rely-on-time
        allVotes[currVoteId] = VoteYesNo(new address[](0), 0, false, currentTime, currentTime);
        emit VoteCreated(currVoteId);
    }

    function tallyVote(uint _voteId) private {
        require(allVotes[_voteId].voteTallied == false, "Vote has already been tallied");

        // Find winner
        uint winningProposal = 0;  // determineWinner(_voteId);
        uint winningTally = 0;
        allVotes[_voteId].winner = winningProposal;
        allVotes[_voteId].endTime = now; // solhint-disable-line not-rely-on-time
        allVotes[_voteId].voteTallied = true;
        emit VoteTallied(_voteId, winningProposal, winningTally);
    }

    //
    // Methods for creating new derivatives
    //
}  // End of contract
