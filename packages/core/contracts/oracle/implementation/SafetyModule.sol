// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./Finder.sol";
import "./GovernorV2.sol"; //todo: swap this to using an interface.
import "./Constants.sol";
import "../interfaces/StakerInterface.sol";
import "./AdminIdentifierLib.sol";
import "../../common/implementation/Lockable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract SafteyModule is Ownable, Lockable {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint256 public bond;
    GovernorV2 public immutable governor;
    Finder public immutable finder;

    struct EmergencyProposal {
        address proposer;
        uint64 time;
        uint256 lockedBond;
        uint256 cumulativeSignaled;
        mapping(address => uint256) accountSignaled;
        bool ratified;
    }
    EmergencyProposal[] public emergencyProposals;

    uint256 emergencyActionThreshold = 0.5e18;

    address public emergencyActionAuthenticator;

    event BondSet(uint256 bond);
    event ProposalResolved(uint256 indexed id, bool success);

    constructor(
        IERC20 _token, //todo: swap this to having the "voting token" in the finder and remove this.
        uint256 _bond,
        GovernorV2 _governor, // todo: add the governor to the finder and remove this.
        Finder _finder
    ) {
        token = _token;
        governor = _governor;
        finder = _finder;
        setBond(_bond);
        transferOwnership(address(_governor));
    }

    function proposeEmergencyAction(GovernorV2.Transaction[] memory transactions)
        external
        nonReentrant()
        returns (uint256)
    {
        uint256 id = emergencyProposals.length - 1;
        emergencyProposals.push();
        token.safeTransferFrom(msg.sender, address(this), bond);
        emergencyProposals[id].proposer = msg.sender;
        emergencyProposals[id].lockedBond = bond;
        emergencyProposals[id].time = uint64(getCurrentTime());

        governor.proposeEmergencyAction(transactions);
        return id;
    }

    function signalOnEmergencyProposal(uint256 id) public {
        EmergencyProposal storage emergencyProposal = emergencyProposals[id];

        require(emergencyProposal.accountSignaled[msg.sender] == 0);

        emergencyProposal.accountSignaled[msg.sender] = getVoterStake(msg.sender);
        emergencyProposal.cumulativeSignaled += emergencyProposal.accountSignaled[msg.sender];
    }

    function cancelSignalOnEmergencyProposal(uint256 id) public {
        EmergencyProposal storage emergencyProposal = emergencyProposals[id];

        require(emergencyProposal.accountSignaled[msg.sender] > 0);

        // Decrement the cumulative signaled amount by the amount the user signed with in the beginning. We use this
        // rather than using their activeStake as they may have changed this during the time they were signaled.
        emergencyProposal.cumulativeSignaled -= emergencyProposal.accountSignaled[msg.sender];
        emergencyProposal.accountSignaled[msg.sender] = 0; // Reset the signaled amount to 0.
    }

    function ratifyEmergencyProposal(uint256 id) public {
        require(msg.sender == emergencyActionAuthenticator, "Only callable by the emergency action authenticator");
        EmergencyProposal storage emergencyProposal = emergencyProposals[id];
        require(emergencyProposal.ratified == false);
        require((emergencyProposal.cumulativeSignaled * 1e18) / getCumulativeStake() >= emergencyActionThreshold);
        emergencyProposal.ratified = true;
    }

    function setBond(uint256 _bond) public nonReentrant() onlyOwner() {
        bond = _bond;
        emit BondSet(_bond);
    }

    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function getVoterStake(address voter) public view returns (uint256) {
        return getStakerContract().getVoterStake(voter);
    }

    function getCumulativeStake() public view returns (uint256) {
        return getStakerContract().getCumulativeStake();
    }

    function getStakerContract() public view returns (StakerInterface) {
        return StakerInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function isProposalRatified(uint256 id) public view returns (bool) {
        return emergencyProposals[id].ratified;
    }
}
