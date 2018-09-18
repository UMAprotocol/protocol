/*
  VoteCoin implementation

  Implements an early version of VoteCoin protocols

  * ERC20 token
  * Uses Oraclize to fetch ETH/USD exchange rate
  * Allows users to vote yes/no on whether a price is accurate

*/
pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "./Derivative.sol";


contract VoteCoin is ERC20, usingOraclize {

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
    event NewVote(uint _voteID);
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
    string public ETHUSD = "0";

    // Derivative Market attached to VoteCoin for now -- Could be separated
    // into its own type, but this is easy for now
    // DerivativeContract[] allDerivatives = new DerivativeContract[](0);

    // For development
    address OAR = OraclizeAddrResolverI(0x6f485C8BF6fc43eA212E93BBF8ce046C7f1cb475);

    constructor() public payable {
        voteDuration = 120;

        _mint(msg.sender, 10000);

        currVoteId = 0;
        newVote();
        // updatePrice();

        emit LogConstructorInitiated("Constructor was initiated. Call 'updatePrice()' to send the Oraclize Query.");
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

        VoteYesNo storage vote = allVotes[_voteID];
        require(vote.voteTallied == false);

        bool alreadyVoted = vote.votedFor[_voter] != 0;

        // Set address vote to _proposal
        vote.votedFor[_voter] = _proposal;

        // If this is first time, add them to voters array
        if (alreadyVoted) {
            emit VoterChangedVote(_voter, _proposal);
        } else {
            vote.voters.push(_voter);
            emit VoterVoted(_voter, _proposal);
        }
    }

    function vote(uint _voteID, uint _proposal) external {
        _vote(msg.sender, _voteID, _proposal);
    }

    function newVote() private {
        currVoteId++;

        allVotes[currVoteId] = VoteYesNo(new address[](0), 0, false, now, now);
        emit NewVote(currVoteId);
    }

    function determineWinner(uint _voteId) internal view returns (uint winningProposal) {
        uint voted2 = 0;
        VoteYesNo storage vote = allVotes[_voteId];
        uint nVoters = vote.voters.length;

        // Declare variables used later
        address currVoter;
        uint currProposalVote;
        uint currWeight;
        uint totalWeight;
        for (uint i=0; i<nVoters; i++) {
            currVoter = vote.voters[i];
            currProposalVote = vote.votedFor[currVoter];
            currWeight = balanceOf(currVoter);
            totalWeight = totalWeight + currWeight;
            if (currProposalVote == 2) {
                voted2 = voted2 + currWeight;
            }
        }

        winningProposal = totalWeight - voted2 < voted2 ? 2 : 1;
    }

    function tallyVote(uint _voteId) private {
        require(allVotes[_voteId].voteTallied == false, "Vote has already been tallied");

        // Find winner
        uint winningProposal = 0;  // determineWinner(_voteId);
        uint winningTally = 0;
        allVotes[_voteId].winner = winningProposal;
        allVotes[_voteId].endTime = now;
        allVotes[_voteId].voteTallied = true;
        emit VoteTallied(_voteId, winningProposal, winningTally);
    }

    //
    // Methods for retrieving price and checking whether verified
    //
    function __callback(bytes32 myid, string result) public {
        if (msg.sender != oraclize_cbAddress()) revert();

        // Tally old vote
        tallyVote(currVoteId);

        // Here we could issue rewards for having voting with majority

        // Price arrives
        ETHUSD = result;
        emit LogPriceUpdated(ETHUSD);

        // Create new vote
        newVote();

        updatePrice();
    }

    function updatePrice() public payable {
        if (oraclize_getPrice("URL") > address(this).balance) {
            emit LogNewOraclizeQuery("Oraclize query was NOT sent, please add some ETH to cover for the query fee");
        } else {
            emit LogNewOraclizeQuery("Oraclize query was sent, standing by for the answer..");
            // Waits `voteDuration` and then sends query
            oraclize_query(voteDuration, "URL", "json(https://api.gdax.com/products/ETH-USD/ticker).price");
        }
    }

    //
    // Methods for creating new derivatives
    //
}  // End of contract
