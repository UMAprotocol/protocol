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
    string public _product;
    uint public _size;

    // Other addresses/contracts
    address public ownerAddress;          // should this be public?
    address public counterpartyAddress;   //
    VoteTokenInterface public oracle;

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;
    uint public lastRemarginTime;

    int256 public npv;  // Net present value is measured in Wei
    mapping(address => bool) public hasConfirmedPrice;

    constructor(
        address _ownerAddress,
        address _counterpartyAddress,
        address _oracleAddress,
        int256 _defaultPenalty,
        int256 _requiredMargin,
        uint expiry,
        string product,
        uint size
    ) public payable {
        ownerAddress = _ownerAddress;

        // Contract states
        endTime = expiry;
        lastRemarginTime = now;
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        npv = initialNpv();

        // Address information
        oracle = VoteTokenInterface(_oracleAddress);
        counterpartyAddress = _counterpartyAddress;
        balances[ownerAddress] = int256(msg.value);
        balances[counterpartyAddress] = 0;
        _product = product;
        _size = size;
    }

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeNpv` and `initialNpv` function. This allows for generic choices of NPV
    // functions.
    function computeNpv(int256 oraclePrice) public view returns (int256 npvNew);
    // Get the NPV that the contract where the contract is expected to start. Since this is the zero point for the
    // contract, the contract will only move money when the computed NPV differs from this value. For example, if
    // `initialNpv()` returns 50, the contract would move 1 Wei if the contract were remargined and
    // `computeUnverifiedNpv` returned 51.
    function initialNpv() public view returns (int256 npvNew);

    function confirmPrice() public {
        // Figure out who is who
        require(msg.sender == ownerAddress || msg.sender == counterpartyAddress);
        address confirmer = msg.sender;
        address other = msg.sender == ownerAddress ? counterpartyAddress : ownerAddress;

        // Confirmer confirmed...
        hasConfirmedPrice[confirmer] = true;

        // If both have confirmed then advance state to settled
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin
        if (hasConfirmedPrice[other]) {
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

        // Checks whether contract has ended
        (uint currentTime, int256 oraclePrice) = oracle.unverifiedPrice();
        require(currentTime != 0);
        if (currentTime >= endTime) {
            (currentTime, oraclePrice) = oracle.unverifiedPrice(endTime);
            state = State.Expired;
        }

        lastRemarginTime = currentTime;

        // Update npv of contract
        return  _remargin(computeNpv(oraclePrice));
    }

    function settleAgreedPrice() public {
        // TODO: Currently no enforcement mechanism to check whether people have agreed upon the current unverified
        //       price. This needs to be addressed.
        (uint currentTime,) = oracle.unverifiedPrice();
        require(currentTime >= endTime);
        (, int256 oraclePrice) = oracle.verifiedPrice(endTime);

        _settle(oraclePrice);
    }

    function settleVerifiedPrice() public {
        (uint currentTime,) = oracle.verifiedPrice();
        require(currentTime >= endTime);
        (, int256 oraclePrice) = oracle.verifiedPrice(endTime);

        _settle(oraclePrice);
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

    function npvIfRemarginedImmediately() public view returns (int256 immediateNpv) {
        // Checks whether contract has ended
        (uint currentTime, int256 oraclePrice) = oracle.unverifiedPrice();
        require(currentTime != 0);
        if (currentTime >= endTime) {
            (currentTime, oraclePrice) = oracle.unverifiedPrice(endTime);
            state = State.Expired;
        }

        return computeNpv(oraclePrice);
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

    // Function is internally only called by `settleAgreedPrice` or `settleVerifiedPrice`. This function handles all of
    // the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int256 price) internal returns (bool success) {

        // Remargin at whatever price we're using (verified or unverified)
        success = _remargin(computeNpv(price));
        require(success == true);

        // Check whether goes into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (inDefault) {
            int256 penalty;
            penalty = (balances[defaulter] < defaultPenalty) ?
                balances[defaulter] :
                defaultPenalty;

            balances[defaulter] -= penalty;
            balances[notDefaulter] += penalty;
        }
        state = State.Settled;

        return success;
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
            (endTime,) = oracle.unverifiedPrice(); // Change end time to moment when default occurred
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
        (, int256 oraclePrice) = oracle.unverifiedPrice(endTime);
        int256 ownerDiff = _getOwnerNpvDiff(computeNpv(oraclePrice));

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

    constructor(
        address _ownerAddress,
        address _counterpartyAddress,
        address _oracleAddress,
        int256 _defaultPenalty,
        int256 _requiredMargin,
        uint expiry,
        string product,
        uint size
    ) public payable Derivative(
        _ownerAddress,
        _counterpartyAddress,
        _oracleAddress,
        _defaultPenalty,
        _requiredMargin,
        expiry,
        product,
        size) {}

    function computeNpv(int256 oraclePrice) public view returns (int256 npvNew) {
        // This could be more complex, but in our case, just return the oracle value.
        return oraclePrice;
    }

    function initialNpv() public view returns (int256 npvNew) {
        return 0;
    }

}
