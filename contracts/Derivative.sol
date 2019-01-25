/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";
import "./ContractCreator.sol";
import "./PriceFeedInterface.sol";
import "./OracleInterface.sol";


contract Derivative {
    using SafeMath for uint;
    using SignedSafeMath for int;

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
        // Possible state transitions: Settled.
        Disputed,

        // The contract has passed its expiration and the final remargin has occurred. The contract is waiting for the
        // Oracle price to become available, and as such, it is not possible to dispute.
        // Possible state transitions: Settled.
        Expired,

        // One party failed to keep their margin above the required margin, so the contract has gone into default.
        // If both parties agree the contract is in default then becomes settled. Otherwise, call settle() after an
        // Oracle price is available.
        // Possible state transitions: Settled
        Defaulted,

        // The final remargin has occured, and all parties have agreed on the settlement price. Account balances can be
        // fully withdrawn.
        // Possible state transitions: None.
        Settled
    }

    struct ContractParty {
        address payable accountAddress;
        int balance;
        bool hasConfirmedPrice;
    }

    // Financial information
    int public defaultPenalty;
    int public requiredMargin;
    bytes32 public product;
    uint public notional;

    // Other addresses/contracts
    ContractParty public maker;
    ContractParty public taker;
    OracleInterface public oracle;
    PriceFeedInterface public priceFeed;

    State public state = State.Prefunded;
    uint public endTime;
    uint public lastRemarginTime;
    int public defaultPrice;

    int public npv;  // Net present value is measured in Wei

    constructor(
        address payable _makerAddress,
        address payable _takerAddress,
        address _oracleAddress,
        address _priceFeedAddress,
        int _defaultPenalty,
        int _requiredMargin,
        uint expiry,
        bytes32 _product,
        uint _notional
    ) public payable {
        // Address information
        oracle = OracleInterface(_oracleAddress);
        priceFeed = PriceFeedInterface(_priceFeedAddress);
        require(oracle.isIdentifierSupported(_product));
        require(priceFeed.isIdentifierSupported(_product));
        // TODO: Think about who is sending the `msg.value`
        require(_makerAddress != _takerAddress);
        maker = ContractParty(_makerAddress, 0, false);
        taker = ContractParty(_takerAddress, int(msg.value), false);

        // Contract states
        endTime = expiry;
        lastRemarginTime = 0;
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        product = _product;
        notional = _notional;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (, int oraclePrice) = priceFeed.latestPrice(_product);
        npv = initialNpv(oraclePrice, notional);
    }

    function confirmPrice() external {
        // Right now, can only confirm when in the Defaulted state. At expiry and during disputes, the Oracle is invoked
        // and settle() should be used instead.
        require(state == State.Defaulted);

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

    function deposit() external payable {
        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state
        require(state == State.Live || state == State.Prefunded);
        (ContractParty storage depositer,) = _whoAmI(msg.sender);
        depositer.balance = depositer.balance.add(int(msg.value));  // Want this to be safemath when available

        if (state == State.Prefunded) {
            if (maker.balance >= _requiredAccountBalanceOnRemargin(maker) &&
                taker.balance >= _requiredAccountBalanceOnRemargin(taker)) {
                state = State.Live;
                remargin();
            }
        }
    }

    function dispute() external {
        require(msg.sender == maker.accountAddress || msg.sender == taker.accountAddress);

        require(
            // TODO: We need to add the dispute bond logic
            state == State.Live,
            "Contract must be Live to dispute"
        );
        state = State.Disputed;
        endTime = lastRemarginTime;
        _requestOraclePrice();
    }

    function withdraw(uint amount) external payable {
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
        int withdrawableAmount = (state == State.Prefunded || state == State.Settled) ?
            withdrawer.balance :
            withdrawer.balance.sub(requiredMargin);

        // Can only withdraw the allowed amount
        require(
            (int(withdrawableAmount) >= int(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        withdrawer.balance = withdrawer.balance.sub(int(amount));
        withdrawer.accountAddress.transfer(amount);
    }

    function requiredAccountBalanceOnRemargin() external view returns (int balance) {
        (ContractParty storage sender,) = _whoAmI(msg.sender);

        return _requiredAccountBalanceOnRemargin(sender);
    }

    function npvIfRemarginedImmediately() external view returns (int immediateNpv) {
        // Checks whether contract has ended
        (uint currentTime, int price) = priceFeed.latestPrice(product);

        require(currentTime != 0);
        // If the contract has expired, we don't have a price exactly for expiry, and we can't kick off an Oracle
        // request from this `view` function.
        require(currentTime < endTime);

        return computeNpv(price, notional);
    }

    function settle() public {
        require(state == State.Disputed || state == State.Expired || state == State.Defaulted);
        _settleVerifiedPrice();
    }

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeNpv` and `initialNpv` function. This allows for generic choices of NPV
    // functions.
    function computeNpv(int oraclePrice, uint _notional) public view returns (int npvNew);
    // Get the NPV that the contract where the contract is expected to start. Since this is the zero point for the
    // contract, the contract will only move money when the computed NPV differs from this value. For example, if
    // `initialNpv()` returns 50, the contract would move 1 Wei if the contract were remargined and
    // `computeUnverifiedNpv` returned 51.
    function initialNpv(int oraclePrice, uint _notional) public view returns (int npvNew);

    function remargin() public {
        // If the state is not live, remargining does not make sense.
        require(state == State.Live);

        // Checks whether contract has ended
        (uint currentTime, int price) = priceFeed.latestPrice(product);
        require(currentTime != 0);
        if (currentTime >= endTime) {
            state = State.Expired;
            _requestOraclePrice();
        }
        lastRemarginTime = currentTime;

        // Update npv of contract
        _updateBalances(computeNpv(price, notional));

        // Make sure contract has not moved into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (inDefault) {
            state = State.Defaulted;
            endTime = currentTime; // Change end time to moment when default occurred
            defaultPrice = price;
            _requestOraclePrice();
        }
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

    function _requestOraclePrice() internal {
        (uint oracleTime, , ) = oracle.getPrice(product, endTime);
        // If the Oracle price is already available, settle the contract immediately with that price.
        if (oracleTime != 0) {
            settle();
        }
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
    function _settle(int price) internal {

        // Update balances at whatever price we're using (verified or unverified)
        _updateBalances(computeNpv(price, notional));

        // Check whether goes into default
        (bool inDefault, address _defaulter, ) = whoDefaults();

        if (inDefault) {
            (ContractParty storage defaulter, ContractParty storage notDefaulter) = _whoAmI(_defaulter);
            int penalty;
            penalty = (defaulter.balance < defaultPenalty) ?
                defaulter.balance :
                defaultPenalty;

            defaulter.balance = defaulter.balance.sub(penalty);
            notDefaulter.balance = notDefaulter.balance.add(penalty);
        }
        state = State.Settled;
    }

    function _settleAgreedPrice() internal {
        _settle(defaultPrice);
    }

    function _settleVerifiedPrice() internal {
        (uint oracleTime, int oraclePrice, ) = oracle.getPrice(product, endTime);
        require(oracleTime != 0);
        _settle(oraclePrice);
    }

    function _updateBalances(int npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable.
        int makerDiff = _getMakerNpvDiff(npvNew);
        npv = npvNew;

        maker.balance = maker.balance.add(makerDiff);
        taker.balance = taker.balance.sub(makerDiff);
    }

    // Gets the change in balance for the owners account when the most recent
    // NPV is applied. Note: there's a function for this because signage is
    // tricky here, and it must be done the same everywhere.
    function _getMakerNpvDiff(int npvNew) internal view returns (int ownerNpvDiff) {
        return npv.sub(npvNew);
    }

    function _requiredAccountBalanceOnRemargin(ContractParty storage party) internal view returns (int balance) {
        (uint time, int price) = priceFeed.latestPrice(product);
        // TODO(ptare): Loosen this requirement.
        require(time <= endTime);
        int makerDiff = _getMakerNpvDiff(computeNpv(price, notional));

        if (party.accountAddress == maker.accountAddress) {
            balance = requiredMargin.sub(makerDiff);
        } else if (party.accountAddress == taker.accountAddress) {
            balance = requiredMargin.add(makerDiff);
        }

        balance = balance > 0 ? balance : 0;
    }
}


contract SimpleDerivative is Derivative {

    constructor(
        address payable _ownerAddress,
        address payable _counterpartyAddress,
        address _oracleAddress,
        address _priceFeedAddress,
        int _defaultPenalty,
        int _requiredMargin,
        uint expiry,
        bytes32 _product,
        uint _notional
    ) public payable Derivative(
        _ownerAddress,
        _counterpartyAddress,
        _oracleAddress,
        _priceFeedAddress,
        _defaultPenalty,
        _requiredMargin,
        expiry,
        _product,
        _notional) {} // solhint-disable-line no-empty-blocks

    function computeNpv(int oraclePrice, uint _notional) public view returns (int npvNew) {
        // This could be more complex, but in our case, just return the oracle value.
        return oraclePrice.mul(int(_notional)).div(1 ether);
    }

    function initialNpv(int oraclePrice, uint _notional) public view returns (int npvNew) {
        return oraclePrice.mul(int(_notional)).div(1 ether);
    }

}


contract DerivativeCreator is ContractCreator {
    constructor(address registryAddress, address _oracleAddress, address _storeAddress, address _priceFeedAddress)
        public
        ContractCreator(
            registryAddress, _oracleAddress, _storeAddress, _priceFeedAddress) { // solhint-disable-line no-empty-blocks
        }

    function createDerivative(
        address payable counterparty,
        int defaultPenalty,
        int requiredMargin,
        uint expiry,
        bytes32 product,
        uint notional
    )
        external
        payable
        returns (address derivativeAddress)
    {

        // TODO: Think about which person is going to be creating the contract... Right now, we're assuming it comes
        //       from the taker. This is just for convenience
        SimpleDerivative derivative = (new SimpleDerivative).value(msg.value)(
            counterparty,
            msg.sender,
            oracleAddress,
            priceFeedAddress,
            defaultPenalty,
            requiredMargin,
            expiry,
            product,
            notional
        );

        address[] memory parties = new address[](2);
        parties[0] = msg.sender;
        parties[1] = counterparty; 

        _registerContract(parties, address(derivative));

        return address(derivative);
    }
}
