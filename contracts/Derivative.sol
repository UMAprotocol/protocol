/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity ^0.4.24;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


// This interface allows us to get the Ethereum-USD exchange rate
interface VoteTokenInterface {
    // Gets the latest price-time pair at which an unverified price was published. `publishTime` will be 0 and `price`
    // should be ignored if no unverified prices have been published.
    function unverifiedPrice() external view returns (uint publishTime, int256 price);

    // Gets the price-time pair that an unverified price was published that is nearest to `time` without being greater
    // than `time`. `publishTime` will be 0 and `price` should be ignored if no unverified prices had been published
    // before `publishTime`.
    function unverifiedPrice(uint time) external view returns (uint publishTime, int256 price);

    // Gets the latest price-time pair at which a verified price was published. `publishTime` will be 0 and `price`
    // should be ignored if no verified prices have been published.
    function verifiedPrice() external view returns (uint publishTime, int256 price);

    // Gets the price-time pair that a verified price was published that is nearest to `time` without being greater
    // than `time`. `publishTime` will be 0 and `price` should be ignored if no verified prices had been published
    // before `publishTime`.
    function verifiedPrice(uint time) external view returns (uint publishTime, int256 price);
}


contract Derivative {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    enum State {
        // Both parties have not yet provided the initial margin - they can freely deposit and withdraw, and no
        // remargining happens.
        // Possible state transitions: Live, Settled
        Prefunded,

        // The contract is funded, the required margin has been provided by both parties, and remargining is happening
        // on demand. Parties are only able to withdraw down to the required margin.
        // Possible state transitions: Disputed, Expired, Defaulted.
        Live,

        // One of the parties has disputed the price feed. The contract is frozen until the dispute is resolved.
        // Possible state transitions: Defaulted, Settled.
        Disputed,

        // The contract has passed its expiration and the final remargin has occurred. It is still possible to dispute
        // the settlement price.
        // Possible state transitions: Disputed, Settled.
        Expired,

        // One party failed to keep their margin above the required margin, so the contract has gone into default. If
        // the price is undisputed then the defaulting party will be required to pay a default penalty, but, if
        // disputed, contract becomes disputed and penalty will only be paid if verified price confirms default. If both
        // parties agree the contract is in default then becomes settled
        // Possible state transitions: Disputed, Settled
        Defaulted,

        // The final remargin has occured, and all parties have agreed on the settlement price. Account balances can be
        // fully withdrawn.
        // Possible state transitions: None.
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
    mapping(address => bool) public confirmedPrice;

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

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeNpv`/`initialNpv` function. This allows for generic choices of npv functions.
    function computeNpv(uint _time) public view returns (int256 value);
    function initialNpv() public view returns (int256 value);

    function confirmPrice() public {
        // Figure out who is who
        address confirmer = msg.sender;
        address other = msg.sender == ownerAddress ? counterpartyAddress : ownerAddress;

        // Confirmer confirmed...
        confirmedPrice[confirmer] = true;

        // If both have confirmed then advance state to settled
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin
        if (confirmedPrice[other]) {
            state = State.Settled;
            // Remargin on agreed upon price
            remargin();
        }
    }

    function deposit() public payable returns (bool success) {
        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state
        require(state == State.Live || state == State.Prefunded);
        require(msg.sender == ownerAddress || msg.sender == counterpartyAddress);

        balances[msg.sender] += int256(msg.value);

        if (state == State.Prefunded) {
            if (balances[ownerAddress] > _requiredAccountBalanceOnRemargin(ownerAddress) &&
                balances[counterpartyAddress] > _requiredAccountBalanceOnRemargin(counterpartyAddress)) {
                state = State.Live;
                remargin();
            }
        }
        return true;
    }

    function dispute() public {
        require(
            state == State.Live ||
            state == State.Expired ||
            state == State.Defaulted,
            "Contract must be Live/Expired/Defaulted to dispute"
        );
        state = State.Disputed;
    }

    function remargin() public returns (bool success) {
        // If the state is not live, remargining does not make sense.
        if (state != State.Live) {
            return false;
        }

        // TODO: If the contract is expired, remargin to the NPV at expiry
        // rather than the current NPV.
        // Checks whether contract has ended
        (uint npvTime, int256 _) = oracle.unverifiedPrice(); // Double check this
        if (npvTime > endTime) {
            npvTime = endTime;
            state = State.Expired;
        }

        // Update npv of contract
        // Need to give normalized time
        int256 npvNew = computeNpv(npvTime);
        success = _remargin(npvNew);

        return success;
    }

    function settleAgreedPrice() public {
        remargin();
        _settle();
        state = State.Settled;
    }

    function settleVerifiedPrice() public {
        int256 npvNew = computeNpv(endTime);
        bool success = _remargin(npvNew);
        _settle();
        state = State.Settled;
    }

    function withdraw(uint256 amount) public payable returns (bool success) {
        // Make sure either in Prefunded, Live, or Settled
        require(state == State.Prefunded || state == State.Live || state == State.Settled);

        // Remargin before allowing a withdrawal.
        remargin();

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states
        int256 withdrawableAmount = (state == State.Prefunded || state == State.Settled) ?
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

    function isDefault(address party) public view returns (bool) {
        return balances[party] < requiredMargin;
    }

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        return _requiredAccountBalanceOnRemargin(msg.sender);
    }

    function whoDefaults() public view returns (bool inDefault, address defaulter, address notDefaulter) {
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

    function _settle() internal returns (bool success) {

        // Check whether goes into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (state == State.Defaulted) {
            int256 penalty;
            penalty = (balances[defaulter] < defaultPenalty) ?
                balances[defaulter] :
                defaultPenalty;

            balances[defaulter] -= penalty;
            balances[notDefaulter] += penalty;
            state = State.Defaulted;
        }

        return true;
    }

    // Remargins the account based on a provided NPV value.
    // The internal remargin method allows certain calls into the contract to
    // automatically remargin to non-current NPV values (time of expiry, last
    // agreed upon price, etc).
    function _remargin(int256 npvNew) internal returns (bool success) {
        // Update the balances of contract
        _updateBalances(npvNew);

        // Make sure contract has not moved into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (inDefault) {
            state = State.Defaulted;
            int256 price;
            (endTime, price) = oracle.unverifiedPrice(); // Change end time to moment when default occurred
        }

        return true;
    }

    function _updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable.
        int256 ownerDiff = _getOwnerNpvDiff(npvNew);
        npv = npvNew;

        balances[ownerAddress] += ownerDiff;
        balances[counterpartyAddress] -= ownerDiff;
    }

    // Gets the change in balance for the owners account when the most recent
    // NPV is applied. Note: there's a function for this because signage is
    // tricky here, and it must be done the same everywhere.
    function _getOwnerNpvDiff(int256 npvNew) internal view returns (int256 ownerNpvDiff) {
        return npv - npvNew;
    }

    function _requiredAccountBalanceOnRemargin(address party) internal view returns (int256 balance) {
        int256 ownerDiff = _getOwnerNpvDiff(computeNpv(now));

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

    function computeNpv(uint _time) public view returns (int256 price) {
        (_time, price) = oracle.unverifiedPrice(_time);

        return price;
    }

    function initialNpv() public view returns (int256 value) {
        return 0;
    }
}
