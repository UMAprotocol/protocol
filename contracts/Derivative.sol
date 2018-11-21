/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity >=0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./OracleInterface.sol";


contract Derivative {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;
    // using SafeMath for int256;

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

    struct ContractParty {
        address accountAddress;
        int256 balance;
        bool hasConfirmedPrice;
    }

    // Financial information
    int256 public defaultPenalty;
    int256 public requiredMargin;
    string public product;
    uint public notional;

    // Other addresses/contracts
    ContractParty public maker;
    ContractParty public taker;
    OracleInterface public oracle;

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;
    uint public lastRemarginTime;

    int256 public npv;  // Net present value is measured in Wei

    constructor(
        address _makerAddress,
        address _takerAddress,
        address _oracleAddress,
        int256 _defaultPenalty,
        int256 _requiredMargin,
        uint expiry,
        string _product,
        uint _notional
    ) public payable {
        // Address information
        oracle = OracleInterface(_oracleAddress);
        // TODO: Think about who is sending the `msg.value`
        require(_makerAddress != _takerAddress);
        maker = ContractParty(_makerAddress, 0, false);
        taker = ContractParty(_takerAddress, int256(msg.value), false);

        // Contract states
        endTime = expiry;
        lastRemarginTime = 0;
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        product = _product;
        notional = _notional;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (, int256 oraclePrice) = oracle.latestUnverifiedPrice();
        npv = initialNpv(oraclePrice, notional);
    }

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeNpv` and `initialNpv` function. This allows for generic choices of NPV
    // functions.
    function computeNpv(int256 oraclePrice, uint _notional) public view returns (int256 npvNew);
    // Get the NPV that the contract where the contract is expected to start. Since this is the zero point for the
    // contract, the contract will only move money when the computed NPV differs from this value. For example, if
    // `initialNpv()` returns 50, the contract would move 1 Wei if the contract were remargined and
    // `computeUnverifiedNpv` returned 51.
    function initialNpv(int256 oraclePrice, uint _notional) public view returns (int256 npvNew);

    function confirmPrice() public {
        // Right now, only dispute if in a pre-settlement state
        require(state == State.Expired || state == State.Defaulted || state == State.Disputed);

        // Figure out who is who
        (ContractParty storage confirmer, ContractParty storage other) = _whoAmI(msg.sender);

        // Confirmer confirmed...
        confirmer.hasConfirmedPrice = true;

        // If both have confirmed then advance state to settled
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin
        if (other.hasConfirmedPrice) {
            // Remargin on agreed upon price
            _settleAgreedPrice();
        }
    }

    function deposit() public payable {
        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state
        require(state == State.Live || state == State.Prefunded);
        (ContractParty storage depositer,) = _whoAmI(msg.sender);
        depositer.balance += int256(msg.value);  // Want this to be safemath when available

        if (state == State.Prefunded) {
            if (maker.balance >= _requiredAccountBalanceOnRemargin(maker) &&
                taker.balance >= _requiredAccountBalanceOnRemargin(taker)) {
                state = State.Live;
                remargin();
            }
        }
    }

    function dispute() public {
        require(msg.sender == maker.accountAddress || msg.sender == taker.accountAddress);

        require(
            // TODO: We need to add the dispute bond logic
            state == State.Live ||
            state == State.Expired ||
            state == State.Defaulted,
            "Contract must be Live/Expired/Defaulted to dispute"
        );
        state = State.Disputed;
        endTime = lastRemarginTime;
    }

    function remargin() public {
        // If the state is not live, remargining does not make sense.
        require(state == State.Live);

        // Checks whether contract has ended
        (uint currentTime, int256 oraclePrice) = oracle.latestUnverifiedPrice();
        require(currentTime != 0);
        if (currentTime >= endTime) {
            (currentTime, oraclePrice) = oracle.unverifiedPrice(endTime);
            state = State.Expired;
        }

        lastRemarginTime = currentTime;

        // Update npv of contract
        return  _remargin(computeNpv(oraclePrice, notional));
    }

    function settle() public {
        require(state == State.Disputed || state == State.Expired || state == State.Defaulted);
        _settleVerifiedPrice();
    }

    function withdraw(uint256 amount) public payable {
        // Make sure either in Prefunded, Live, or Settled
        require(state == State.Prefunded || state == State.Live || state == State.Settled);

        (ContractParty storage withdrawer,) = _whoAmI(msg.sender);

        // Remargin before allowing a withdrawal, but only if in the live state.
        if (state == State.Live) {
            remargin();
        }

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states
        int256 withdrawableAmount = (state == State.Prefunded || state == State.Settled) ?
            withdrawer.balance :
            withdrawer.balance - requiredMargin;

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawableAmount) >= int256(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        withdrawer.balance -= int256(amount);
        withdrawer.accountAddress.transfer(amount);
    }

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        (ContractParty storage sender,) = _whoAmI(msg.sender);

        return _requiredAccountBalanceOnRemargin(sender);
    }

    function npvIfRemarginedImmediately() public view returns (int256 immediateNpv) {
        // Checks whether contract has ended
        (uint currentTime, int256 oraclePrice) = oracle.latestUnverifiedPrice();
        require(currentTime != 0);
        if (currentTime >= endTime) {
            (, oraclePrice) = oracle.unverifiedPrice(endTime);
        }

        return computeNpv(oraclePrice, notional);
    }

    // TODO: Think about a cleaner way to do this -- It's ugly because we're leveraging the "ContractParty" struct in
    //       every other place and here we're returning addresses. We probably want a nice public method that returns
    //       something intuitive and an internal method that's a little easier to use inside the contract, but messier
    //       for outside
    function whoDefaults() public view returns (bool inDefault, address defaulter, address notDefaulter) {
        inDefault = false;

        if (_isDefault(maker)) {
            defaulter = maker.accountAddress;
            notDefaulter = taker.accountAddress;
            inDefault = true;
        } else if (_isDefault(taker)) {
            defaulter = taker.accountAddress;
            notDefaulter = maker.accountAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    function _isDefault(ContractParty storage party) internal view returns (bool) {
        return party.balance < requiredMargin;
    }

    function _whoAmI(address sndrAddr) internal view returns (ContractParty storage sndr, ContractParty storage othr) {
        bool senderIsMaker = (sndrAddr == maker.accountAddress);
        bool senderIsTaker = (sndrAddr == taker.accountAddress);
        require(senderIsMaker || senderIsTaker); // At least one should be true

        return senderIsMaker ? (maker, taker) : (taker, maker);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int256 price) internal {

        // Remargin at whatever price we're using (verified or unverified)
        _remargin(computeNpv(price, notional));

        // Check whether goes into default
        (bool inDefault, address _defaulter, ) = whoDefaults();

        if (inDefault) {
            (ContractParty storage defaulter, ContractParty storage notDefaulter) = _whoAmI(_defaulter);
            int256 penalty;
            penalty = (defaulter.balance < defaultPenalty) ?
                defaulter.balance :
                defaultPenalty;

            defaulter.balance -= penalty;
            notDefaulter.balance += penalty;
        }
        state = State.Settled;
    }

    function _settleAgreedPrice() internal {
        (uint currentTime,) = oracle.latestUnverifiedPrice();
        require(currentTime >= endTime);
        (, int256 oraclePrice) = oracle.unverifiedPrice(endTime);

        _settle(oraclePrice);
    }

    function _settleVerifiedPrice() internal {
        (uint currentTime,) = oracle.latestVerifiedPrice();
        require(currentTime >= endTime);
        (, int256 oraclePrice) = oracle.verifiedPrice(endTime);

        _settle(oraclePrice);
    }

    // Remargins the account based on a provided NPV value.
    // The internal remargin method allows certain calls into the contract to
    // automatically remargin to non-current NPV values (time of expiry, last
    // agreed upon price, etc).
    function _remargin(int256 npvNew) internal {
        // Update the balances of contract
        _updateBalances(npvNew);

        // Make sure contract has not moved into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (inDefault) {
            state = State.Defaulted;
            (endTime,) = oracle.latestUnverifiedPrice(); // Change end time to moment when default occurred
        }
    }

    function _updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable.
        int256 makerDiff = _getMakerNpvDiff(npvNew);
        npv = npvNew;

        maker.balance += makerDiff;
        taker.balance -= makerDiff;
    }

    // Gets the change in balance for the owners account when the most recent
    // NPV is applied. Note: there's a function for this because signage is
    // tricky here, and it must be done the same everywhere.
    function _getMakerNpvDiff(int256 npvNew) internal view returns (int256 ownerNpvDiff) {
        return npv - npvNew;
    }

    function _requiredAccountBalanceOnRemargin(ContractParty storage party) internal view returns (int256 balance) {
        (, int256 oraclePrice) = oracle.unverifiedPrice(endTime);
        int256 makerDiff = _getMakerNpvDiff(computeNpv(oraclePrice, notional));

        if (party.accountAddress == maker.accountAddress) {
            balance = requiredMargin - makerDiff;
        } else if (party.accountAddress == taker.accountAddress) {
            balance = requiredMargin + makerDiff;
        }

        balance = balance > 0 ? balance : 0;
    }
}


contract SimpleDerivative is Derivative {

    constructor(
        address _ownerAddress,
        address _counterpartyAddress,
        address _oracleAddress,
        int256 _defaultPenalty,
        int256 _requiredMargin,
        uint expiry,
        string product,
        uint notional
    ) public payable Derivative(
        _ownerAddress,
        _counterpartyAddress,
        _oracleAddress,
        _defaultPenalty,
        _requiredMargin,
        expiry,
        product,
        notional) {} // solhint-disable-line no-empty-blocks

    function computeNpv(int256 oraclePrice, uint _notional) public view returns (int256 npvNew) {
        // This could be more complex, but in our case, just return the oracle value.
        return (oraclePrice * int256(_notional)) / (1 ether);
    }

    function initialNpv(int256 oraclePrice, uint _notional) public view returns (int256 npvNew) {
        return (oraclePrice * int256(_notional)) / (1 ether);
    }

}
