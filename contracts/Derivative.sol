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

    // Other addresses/contracts
    ContractParty public maker;
    ContractParty public taker;
    VoteTokenInterface public oracle;

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;

    int256 public npv;  // Net present value is measured in Wei
    mapping(address => bool) public hasConfirmedPrice;

    constructor(
        address _makerAddress,
        address _oracleAddress,
        uint _duration,
        int256 _defaultPenalty,
        int256 _requiredMargin
    ) public {

        // Address information
        oracle = VoteTokenInterface(_oracleAddress);
        maker = ContractParty(_makerAddress, 0, false);
        taker = ContractParty(msg.sender, 0, false);

        // Contract states
        startTime = now; // solhint-disable-line not-rely-on-time
        endTime = startTime.add(_duration);
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        npv = initialNpv();
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
        // Right now, only dispute if in a pre-settlement state
        require(state == State.Expired || state == State.Defaulted || state == State.Disputed);

        // Figure out who is who
        bool senderIsMaker = msg.sender == maker.accountAddress;
        bool senderIsTaker = msg.sender == maker.accountAddress;
        require(senderIsMaker || senderIsTaker);
        ContractParty storage confirmer = maker ? senderIsMaker : taker;
        ContractParty storage other = taker ? senderIsMaker : maker;

        // Confirmer confirmed...
        confirmer.hasConfirmedPrice = true;

        // If both have confirmed then advance state to settled
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin
        (uint currentTime,) = oracle.unverifiedPrice();
        if (other.hasConfirmedPrice) {
            state = State.Settled;

            // Remargin on agreed upon price
            (uint unverifiedTime, int256 oraclePrice) = oracle.unverifiedPrice(endTime);
            _remargin(computeNpv(oraclePrice));
        }
    }

    function deposit() public payable returns (bool success) {
        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state
        require(state == State.Live || state == State.Prefunded);
        bool senderIsMaker = msg.sender == maker.accountAddress;
        bool senderIsTaker = msg.sender == maker.accountAddress;
        require(senderIsMaker || senderIsTaker);

        ContractParty storage depositer = maker ? senderIsMaker : taker;
        depositer.balance += int256(msg.value);

        if (state == State.Prefunded) {
            ContractParty storage other = taker ? senderIsMaker : maker;
            if (maker.balances > _requiredAccountBalanceOnRemargin(maker) &&
                taker.balances > _requiredAccountBalanceOnRemargin(taker)) {
                state = State.Live;
                remargin();
            }
        }
        return true;
    }

    function dispute() public {
        require(
            // Right now, we don't allow for disuptes while live, so commented out
            // state == State.Live ||
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

        bool senderIsMaker = msg.sender == maker.accountAddress;
        bool senderIsTaker = msg.sender == taker.accountAddress;
        require(senderIsMaker || senderIsTaker);
        ContractParty storage withdrawer = maker ? senderIsMaker : taker;

        // Remargin before allowing a withdrawal.
        remargin();

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states
        int256 withdrawableAmount = (state == State.Prefunded || state == State.Settled) ?
            withdrawer.balance :
            withdrawer.balance - requiredMargin;

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawableAmount) > int256(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        withdrawer.balance -= int256(amount);
        withdrawer.accountAddress.transfer(amount);

        return true;
    }

    function isDefault(ContractParty storage party) public view returns (bool) {
        return party.balance < requiredMargin;
    }

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        bool senderIsMaker = msg.sender == maker.accountAddress;
        bool senderIsTaker = msg.sender == taker.accountAddress;
        require(senderIsMaker || senderIsTaker);

        ContractParty storage checker = maker ? senderIsMaker : taker;

        return _requiredAccountBalanceOnRemargin(checker);
    }

    function whoDefaults() public view returns (bool inDefault, address defaulter, address notDefaulter) {
        inDefault = false;

        if (isDefault(maker)) {
            defaulter = maker.accountAddress;
            notDefaulter = taker.accountAddress;
            inDefault = true;
        } else if (isDefault(taker)) {
            defaulter = taker.accountAddress;
            notDefaulter = maker.accountAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    // Function is internally only called by `settleAgreedPrice` or `settleVerifiedPrice`. This function handles all of
    // the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int256 price) internal returns (bool success) {

        ContractParty storage checker = maker ? senderIsMaker : taker;

        // Remargin at whatever price we're using (verified or unverified)
        success = _remargin(computeNpv(price));
        require(success == true);

        // Check whether goes into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        bool defaulterIsMaker = defaulter == maker.accountAddress;
        bool defaulterIsTaker = defaulter == taker.accountAddress;
        ContractParty storage defaulter = maker ? defaulterIsMaker : taker;
        ContractParty storage notDefaulter = taker ? defaulterIsMaker : maker;

        if (inDefault) {
            int256 penalty;
            penalty = (defaulter.balance < defaultPenalty) ?
                defaulter.balance :
                defaultPenalty;

            defaulter.balance -= penalty;
            notDefaulter.balance += penalty;
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
        int256 makerDiff = _getMakerNpvDiff(npvNew);
        npv = npvNew;

        maker += makerDiff;
        taker -= takerDiff;
    }

    // Gets the change in balance for the owners account when the most recent
    // NPV is applied. Note: there's a function for this because signage is
    // tricky here, and it must be done the same everywhere.
    function _getMakerNpvDiff(int256 npvNew) internal view returns (int256 ownerNpvDiff) {
        return npv - npvNew;
    }

    function _requiredAccountBalanceOnRemargin(ContractParty storage party) internal view returns (int256 balance) {
        (, int256 oraclePrice) = oracle.unverifiedPrice(endTime);
        int256 makerDiff = _getMakerNpvDiff(computeNpv(oraclePrice));

        if (party.accountAddress == maker.accountAddress) {
            balance = requiredMargin + makerDiff;
        }

        if (party.accountAddress == taker.accountAddress) {
            balance = requiredMargin - makerDiff;
        }

        balance = balance > 0 ? balance : 0;
    }
}


contract DerivativeZeroNPV is Derivative, usingOraclize {

    function computeNpv(int256 oraclePrice) public view returns (int256 npvNew) {
        // This could be more complex, but in our case, just return the oracle value.
        return oraclePrice;
    }

    function initialNpv() public view returns (int256 npvNew) {
        return 0;
    }

}
