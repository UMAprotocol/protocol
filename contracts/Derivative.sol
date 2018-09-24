/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity ^0.4.24;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./VoteTokenInterface.sol";


contract Derivative {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    enum State {
        // Both parties have not yet provided the initial margin - they can freely deposit and withdraw, and no
        // remargining happens. Allowed state transitions: Live, Expired.
        Prefunded,

        // The contract is funded, the required margin has been provided by both parties, and remargining is happening
        // on demand. Parties are only able to withdraw down to the required margin. Possible state transitions:
        // Disputed, Expired, Defaulted.
        Live,

        // One of the parties has disputed the price feed. The contract is frozen until the dispute is resolved.
        // Possible state transitions: Defaulted, Settled.
        Disputed,

        // The contract has passed its expiration and the final remargin has occurred. It is still possible to dispute
        // the settlement price. Possible state transitions: Settled.
        Expired,

        // One party failed to keep their margin above the required margin, so the contract has gone into default.
        // The defaulting party was assessed a penalty and both parties are able to freely withdraw their remaining
        // account balances. Remargining is not allowed. Possible state transitions: None.
        Defaulted,

        // The final remargin has occured, and all parties have agreed on the settlement price. Account balances can be
        // fully withdrawn. Possible state transitions: None.
        Settled
    }

    // Financial information
    mapping(address => int256) public balances; // Stored in Wei
    int256 public defaultPenalty;  //
    int256 public requiredMargin;  //

    // Other addresses/contracts
    address public ownerAddress;          // should this be public?
    address public counterpartyAddress;   //
    VoteTokenInterface public oracle;

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;

    int256 public npv;  // Net present value is measured in Wei

    constructor(
        address _counterpartyAddress,
        address _oracleAddress,
        uint _duration,
        int256 _defaultPenalty,
        int256 _requiredMargin
    ) public {

        // Contract states
        startTime = now; // solhint-disable-line not-rely-on-time
        endTime = startTime.add(_duration);
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        npv = initialNpv();

        // Address information
        oracle = VoteTokenInterface(_oracleAddress);
        counterpartyAddress = _counterpartyAddress;
        balances[ownerAddress] = 0;
        balances[counterpartyAddress] = 0;
    }

    function remargin() public {
        // TODO(mrice32): remargin might make sense for Disputeed and Expired, but the exact flow for those states
        // still needs to be decided.
        // If the state is not live, remargining does not make sense.
        if (state != State.Live) {
            return;
        }

        // Check if time is over...
        // TODO: If the contract is expired, remargin to the NPV at expiry rather than the current NPV.
        uint currentTime = oracle.mostRecentUnverifiedPublishingTime();
        if (currentTime >= endTime) {
            state = State.Expired;
            currentTime = oracle.mostRecentUnverifiedPublishingTime(endTime);
        }

        // Update npv of contract
        (bool success, int256 npvNew) = computeUnverifiedNpv(currentTime);
        assert(success);
        remargin(npvNew);
    }

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeUnverifiedNpv`, `computeVerifiedNpv`, and `initialNpv` function. This allows for generic choices of NPV
    // functions.
    // Compute NPV for a particular timestamp. If the NPV for this time is not available, `success` will be false, and
    // `value` should be ignored.
    function computeUnverifiedNpv(uint timestamp) public view returns (bool success, int256 value);

    // Same as the above, but for the verified price feed.
    function computeVerifiedNpv(uint timestamp) public view returns (bool success, int256 value);

    // Get the NPV that the contract where the contract is expected to start. Since this is the zero point for the
    // contract, the contract will only move money when the computed NPV differs from this value. For example, if
    // `initialNpv()` returns 50, the contract would move 1 Wei if the contract were remargined and
    // `computeUnverifiedNpv` returned 51.
    function initialNpv() public view returns (int256 value);

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        return requiredAccountBalanceOnRemargin(msg.sender);
    }

    function deposit() public payable returns (bool success) {
        require(msg.sender == ownerAddress || msg.sender == counterpartyAddress);

        balances[msg.sender] += int256(msg.value);

        if (state == State.Prefunded) {
            if (balances[ownerAddress] > requiredAccountBalanceOnRemargin(ownerAddress) &&
                balances[counterpartyAddress] > requiredAccountBalanceOnRemargin(counterpartyAddress)) {
                state = State.Live;
                remargin();
            }
        }
        return true;
    }

    function withdraw(uint256 amount) public payable returns (bool success) {
        // Remargin before allowing a withdrawal.
        remargin();

        // If the contract has been defaulted on or terminated then can withdraw
        // up to full balance -- If not then they are required to leave at least
        // `required_margin` in the account. If the contract is in the prefunded
        // state, all parties are allowed to remove any balance they have in the
        // contract.
        int256 withdrawableAmount = (state >= State.Defaulted || state == State.Prefunded) ?
            balances[msg.sender] :
            balances[msg.sender] - requiredMargin;

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawableAmount) > int256(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        balances[msg.sender] -= int256(amount);
        msg.sender.transfer(amount);

        return true;
    }

    function isDefault(address party) public constant returns (bool) {
        return balances[party] < requiredMargin;
    }

    function whoDefaults()
        public
        constant
        returns (bool inDefault, address defaulter, address notDefaulter)
    {
        inDefault = false;

        if (isDefault(ownerAddress)) {
            defaulter = ownerAddress;
            notDefaulter = counterpartyAddress;
            inDefault = true;
        } else if (isDefault(counterpartyAddress)) {
            defaulter = counterpartyAddress;
            notDefaulter = ownerAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    function isExpired(uint time) public constant returns (bool ttt) {
        ttt = state >= State.Expired || time > endTime;
    }

    // Remargins the account based on a provided NPV value.
    // The internal remargin method allows certain calls into the contract to automatically remargin to non-current NPV
    // values (time of expiry, last agreed upon price, etc).
    function remargin(int256 npvNew) internal {
        updateBalances(npvNew);

        // Check for default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();

        // Check whether goes into default
        if (inDefault) {
            int256 penalty;
            penalty = (balances[defaulter] < defaultPenalty) ?
                balances[defaulter] :
                defaultPenalty;

            balances[defaulter] -= penalty;
            balances[notDefaulter] += penalty;
            state = State.Defaulted;
        }
    }

    // Gets the change in balance for the owners account when the most recent NPV is applied.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function getOwnerNpvDiff(int256 npvNew) internal view returns (int256 ownerNpvDiff) {
        return npv - npvNew;
    }

    function updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable.
        int256 ownerDiff = getOwnerNpvDiff(npvNew);
        npv = npvNew;

        balances[ownerAddress] += ownerDiff;
        balances[counterpartyAddress] -= ownerDiff;
    }

    function requiredAccountBalanceOnRemargin(address party) internal view returns (int256 balance) {
        (bool success, int256 npvNew) = computeUnverifiedNpv(oracle.mostRecentUnverifiedPublishingTime());
        require(success);
        int256 ownerDiff = getOwnerNpvDiff(npvNew);

        if (party == ownerAddress) {
            balance = requiredMargin + ownerDiff;
        }

        if (party == counterpartyAddress) {
            balance = requiredMargin - ownerDiff;
        }

        balance = balance > 0 ? balance : 0;
    }
}


contract DerivativeZeroNPV is Derivative, usingOraclize {
    function initialNpv() public view returns (int256 value) {
        return 0;
    }

    function computeUnverifiedNpv(uint timestamp) public view returns (bool success, int256 value) {
        // This could be more complex, but in our case, just return the oracle value.
        return oracle.unverifiedPrice(timestamp);
    }

    function computeVerifiedNpv(uint timestamp) public view returns (bool success, int256 value) {
        // This could be more complex, but in our case, just return the oracle value.
        return oracle.verifiedPrice(timestamp);
    }
}
