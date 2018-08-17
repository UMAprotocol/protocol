pragma solidity ^0.4.22;

contract VoteCoin {

    struct Vote {
        uint nProposals;
        address[] voters;
        bool voteTallied;
        uint winner;
        mapping(address => uint) votedFor;
    }

    // Meta information about tokens
    string public name;
    string public symbol;
    uint public nTokens;

    // Information about balances
    // address[] public tokenOwners;
    mapping(address => uint) public balances;

    // Information used for votes
    uint public nVotes;
    mapping(uint => Vote) public votes;

    function Constuctor() public {
        name = "Test";
        symbol = "TTT";
        nTokens = 1000;
        nVotes = 0;

        balances[msg.sender] = nTokens;
    }

    //
    // Methods related to tokens
    //
    function _transfer(address _from, address _to, uint _amount) private {
        require(balances[_from] >= _amount, "Insufficient Funds");
        require(balances[_to] + _amount > balances[_to]);

        balances[_from] -= _amount;
        balances[_to] += _amount;
    }

    function transfer(address _to, uint _amount) public returns(bool success){
        _transfer(msg.sender, _to, _amount);
        return true;
    }

    //
    // Methods related to voting
    //
    function _vote(address _voter, uint _voteID, uint _proposal) private {
        require(balances[_voter] > 0, "Not enough tokens to vote");

        // Cryptographically sign vote etc...

        // Set address vote to _proposal
        votes[_voteID].votedFor[_voter] = _proposal;

        // Check whether this voter is changing their vote or voting for first
        // time
        uint nVoters = votes[_voteID].voters.length;
        bool alreadyVoted = false;
        for (uint i=0; i<nVoters; i++) {
            if (votes[_voteID].voters[i] == _voter) {
                alreadyVoted = true;
            }
        }

        // If this is first time, add them to voters array
        if (alreadyVoted == false) {
            votes[_voteID].voters.push(_voter);
        }
    }

    function vote(uint _voteID, uint _proposal) public {
        _vote(msg.sender, _voteID, _proposal);
    }

    function newVote(uint _nProposals) public {  // Make this owner only
        // Reset the `currVote` variable so that the voters/tallies are empty
        uint voteID = nVotes++;

        votes[voteID] = Vote(_nProposals, new address[](0), false, 0);
    }

    function tallyVote(uint _voteID) public returns (uint winningProposal){  // Make this owner only
        require(votes[_voteID].voteTallied == false, "Vote has already been tallied");
        votes[_voteID].voteTallied = true;  // Once we've checked, tally begins

        //
        address currVoter;
        uint currProposalVote;
        uint currWeight;


        // Iterate over votes and tally
        uint[] memory tallies;
        uint tallySum = 0;
        uint nVoters = votes[_voteID].voters.length;
        for (uint i=0; i<nVoters; i++) {
            currVoter = votes[_voteID].voters[i];
            currProposalVote = votes[_voteID].votedFor[currVoter];
            currWeight = balances[currVoter];

            tallies[currProposalVote] += currWeight;
            tallySum += currWeight;
        }

        // Make sure the vote makes sense
        require(tallySum <= nTokens);

        // Find winner
        uint winningTally = 0;
        for (i=0; i<votes[_voteID].nProposals; i++) {
            if (tallies[i] < winningTally) {
                winningProposal = i;
                winningTally = tallies[i];
            }
        }
    }

}  // End of contract
