/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity >=0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./OracleInterface.sol";
import "./ContractCreator.sol";


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20 {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;
    // using SafeMath for int256;

    enum State {
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
        uint marginRequirement; // Percentage of nav*10^18
    }

    // Financial information
    uint public defaultPenalty; // Percentage of nav*10^18
    string public product;

    // Other addresses/contracts
    ContractParty public provider;
    ContractParty public investor;
    OracleInterface public oracle;

    State public state;
    uint public startTime;
    uint public endTime;
    uint public lastRemarginTime;
    uint public disputeDeposit;

    int256 public nav;  // Net asset value is measured in Wei

    uint public additionalAuthorizedNav;

    uint public fixedFeePerSecond;

    struct Dispute {
        int256 disputedNav;
        address disputer;
        uint deposit;
    }

    Dispute public dispute;

    uint public constant SECONDS_PER_YEAR = 31536000;

    modifier onlyContractParties {
        require(msg.sender == provider.accountAddress || msg.sender == investor.accountAddress);
        _;
    }

    modifier onlyInvestor {
        require(msg.sender == investor.accountAddress);
    }

    modifier onlyProvider {
        require(msg.sender == provider.accountAddress);
    }

    constructor(
        address _providerAddress,
        address _investorAddress,
        address _oracleAddress,
        uint _defaultPenalty, // Percentage of nav*10^18
        uint _providerRequiredMargin, // Percentage of nav*10^18
        string _product,
        uint _fixedYearlyFee, // Percentage of nav * 10^18
        uint _disputeDeposit // Percentage of nav * 10^18
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(_defaultPenalty <= _providerRequiredMargin);
        require(_providerRequiredMargin <= 1 ether);

        // Address information
        oracle = OracleInterface(_oracleAddress);
        provider = ContractParty(_providerAddress, 0, false, _providerRequiredMargin);

        // Note: the investor is required to have 100% margin at all times.
        investor = ContractParty(_investorAddress, 0, false, 1 ether);

        // Contract states
        lastRemarginTime = 0;
        defaultPenalty = _defaultPenalty;
        product = _product;
        fixedFeePerSecond = _fixedYearlyFee / SECONDS_PER_YEAR;
        disputeDeposit = _disputeDeposit;

        // Set end time to max value of uint to implement no expiry.
        endTime = ~uint(0);


        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        int256 oraclePrice;
        (startTime, oraclePrice) = oracle.latestUnverifiedPrice();
        nav = initialNav(oraclePrice, totalSupply());

        state = State.Live;
    }

    function authorizeTokens(uint newAuthorizedNavInWei) external payable onlyProvider {
        deposit();
        remargin();

        require(state == State.Live);

        additionalAuthorizedNav.add(newAuthorizedNavInWei);
        require(!_reduceAuthorizedTokens(nav));
    }

    function createTokens(bool exact) external payable onlyInvestor {
        require(msg.sender == investor.accountAddress);

        remargin();

        require(state == State.Live);

        uint authorizedNav = additionalAuthorizedNav;
        require(authorizedNav > 0, "Contract is not authorized to provide any tokens");

        uint navToPurchase = msg.value;

        uint refund = 0;

        if (authorizedNav < navToPurchase) {
            require(!exact);

            refund = navToPurchase.sub(authorizedNav);
            navToPurchase = authorizedNav;
        }

        additionalAuthorizedNav.sub(navToPurchase);

        (, int256 oraclePrice) = oracle.unverifiedPrice(endTime);

        _mint(msg.sender, uint(_tokensFromNav(int256(navToPurchase), computeUnitNav(oraclePrice))));

        if (refund != 0) {
            msg.sender.transfer(refund);
        }
    }

    function redeemTokens(uint numTokens) external {
        require((msg.sender == investor.accountAddress && state == State.Live)
            || state == State.Settled);

        if (state == State.Live) {
            remargin();
        }

        require(this.transferFrom(msg.sender, this, numTokens));
        _burn(this, numTokens);


        int256 investorBalance = investor.balance;
        assert(investorBalance >= 0);


        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        uint tokenPercentage = numTokens.mul(1 ether).div(totalSupply());
        uint tokenValue = _takePercentage(uint(investorBalance), tokenPercentage);

        investor.balance -= int256(tokenValue);
        msg.sender.transfer(tokenValue);
    }

    // Concrete contracts should inherit from this contract and then should only need to implement a
    // `computeNav` and `initialNav` function. This allows for generic choices of NAV
    // functions.
    function computeUnitNav(int256 oraclePrice) public view returns (int256 unitNav);

    // Get the NAV that the contract where the contract is expected to start. Since this is the zero point for the
    // contract, the contract will only move money when the computed NAV differs from this value. For example, if
    // `initialNav()` returns 50, the contract would move 1 Wei if the contract were remargined and
    // `computeUnverifiedNav` returned 51.
    function initialUnitNav(int256 oraclePrice) public view returns (int256 unitNav);

    function computeNav(int256 oraclePrice, uint _notional, uint currentTime) public view returns (int256 navNew) {
        int256 unitNav = computeUnitNav(oraclePrice);
        int256 drag = _takePercentage(unitNav, fixedFeePerSecond * (currentTime - startTime));
        int256 navSubDrag = unitNav - drag;
        navNew = (navSubDrag * int256(_notional)) / (1 ether);
        assert(navNew >= 0);
    }

    function initialNav(int256 oraclePrice, uint _notional) public view returns (int256 navNew) {
        // No drag in initial NAV
        navNew = (initialUnitNav(oraclePrice) * int256(_notional)) / (1 ether);
        assert(navNew >= 0);
    }

    function confirmPrice() public onlyContractParties {
        // Right now, only dispute if in a pre-settlement state
        require(state == State.Expired || state == State.Defaulted);

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

    function deposit() public payable onlyProvider {
        // Only allow the provider to deposit margin.

        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state
        require(state == State.Live);
        provider.balance += int256(msg.value);  // Want this to be safemath when available
    }

    function dispute() public payable onlyContractParties {
        require(
            // TODO: We need to add the dispute bond logic
            state == State.Live ||
            state == State.Expired ||
            state == State.Defaulted,
            "Contract must be Live/Expired/Defaulted to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(nav, disputeDeposit));

        require(msg.value >= requiredDeposit);
        uint refund = msg.value - requiredDeposit;

        state = State.Disputed;
        endTime = lastRemarginTime;
        dispute.disputedNav = nav;
        dispute.disputer = msg.sender;
        dispute.deposit = requiredDeposit;

        msg.sender.transfer(refund);
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

        // Update nav of contract

        int256 newNav = computeNav(oraclePrice, totalSupply(), currentTime);
        _remargin(newNav);
        _reduceAuthorizedTokens(newNav);
    }

    function settle() public {
        State startingState = state;
        require(startingState == State.Disputed || startingState == State.Expired || startingState == State.Defaulted);
        _settleVerifiedPrice();
        if (startingState == State.Disputed) {
            (ContractParty storage disputer, ContractParty storage notDisputer) = _whoAmI(dispute.disputer);
            int256 depositValue = int256(dispute.deposit);
            if (nav == dispute.disputedNav) {
                notDisputer.balance += depositValue;
            } else {
                disputer.balance += depositValue;
            }
        }
    }

    function withdraw(uint256 amount) public payable onlyProvider {
        // Make sure either in Live or Settled
        require(state == State.Live || state == State.Settled);

        // Remargin before allowing a withdrawal, but only if in the live state.
        if (state == State.Live) {
            remargin();
        }

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states
        int256 withdrawableAmount = (state == State.Settled) ?
            provider.balance :
            provider.balance - _getRequiredEthMargin(provider, nav);

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawableAmount) >= int256(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        provider.balance -= int256(amount);
        provider.accountAddress.transfer(amount);
    }

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        (ContractParty storage sender,) = _whoAmI(msg.sender);

        return _requiredAccountBalanceOnRemargin(sender);
    }

    function navIfRemarginedImmediately() public view returns (int256 immediateNav) {
        // Checks whether contract has ended
        (uint currentTime, int256 oraclePrice) = oracle.latestUnverifiedPrice();
        require(currentTime != 0);
        if (currentTime >= endTime) {
            (currentTime, oraclePrice) = oracle.unverifiedPrice(endTime);
        }

        return computeNav(oraclePrice, totalSupply(), currentTime);
    }

    // TODO: Think about a cleaner way to do this -- It's ugly because we're leveraging the "ContractParty" struct in
    //       every other place and here we're returning addresses. We probably want a nice public method that returns
    //       something intuitive and an internal method that's a little easier to use inside the contract, but messier
    //       for outside
    function whoDefaults() public view returns (bool inDefault, address defaulter, address notDefaulter) {
        inDefault = false;

        if (_isDefault(provider)) {
            defaulter = provider.accountAddress;
            notDefaulter = provider.accountAddress;
            inDefault = true; 
        } else if (_isDefault(investor)) {
            defaulter = investor.accountAddress;
            notDefaulter = investor.accountAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    function _getRequiredEthMargin(ContractParty storage party, int256 currentNav)
        internal
        view
        returns (int256 requiredEthMargin)
    {
        return _takePercentage(currentNav, party.marginRequirement);
    }

    function _isDefault(ContractParty storage party) internal view returns (bool) {
        return party.balance < _getRequiredEthMargin(party, nav);
    }

    function _whoAmI(address sndrAddr) internal view returns (ContractParty storage sndr, ContractParty storage othr) {
        bool senderIsProvider = (sndrAddr == provider.accountAddress);
        bool senderIsInvestor = (sndrAddr == investor.accountAddress);
        require(senderIsProvider || senderIsInvestor); // At least one should be true

        return senderIsProvider ? (provider, investor) : (investor, provider);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int256 price) internal {

        // Remargin at whatever price we're using (verified or unverified)
        _remargin(computeNav(price, totalSupply(), endTime));

        // Check whether goes into default
        (bool inDefault, address _defaulter, ) = whoDefaults();

        if (inDefault) {
            (ContractParty storage defaulter, ContractParty storage notDefaulter) = _whoAmI(_defaulter);
            int256 penalty;
            int256 expectedDefaultPenalty = _getDefaultPenaltyEth();
            penalty = (defaulter.balance < expectedDefaultPenalty) ?
                defaulter.balance :
                expectedDefaultPenalty;

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

    // Remargins the account based on a provided NAV value.
    // The internal remargin method allows certain calls into the contract to
    // automatically remargin to non-current NAV values (time of expiry, last
    // agreed upon price, etc).
    function _remargin(int256 navNew) internal {
        // Update the balances of contract
        _updateBalances(navNew);

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

    function _updateBalances(int256 navNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int256 longDiff = _getLongNavDiff(navNew);
        nav = navNew;

        investor.balance += longDiff;
        provider.balance -= longDiff;
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongNavDiff(int256 navNew) internal view returns (int256 longNavDiff) {
        return navNew - nav;
    }

    function _requiredAccountBalanceOnRemargin(ContractParty storage party) internal view returns (int256 balance) {
        (uint currentTime, int256 oraclePrice) = oracle.unverifiedPrice(endTime);
        int256 navNew = computeNav(oraclePrice, totalSupply(), currentTime);
        int256 longDiff = _getLongNavDiff(navNew);

        int256 requiredMargin = _getRequiredEthMargin(party, navNew);

        if (party.accountAddress == investor.accountAddress) {
            balance = requiredMargin + longDiff;
        } else if (party.accountAddress == provider.accountAddress) {
            balance = requiredMargin - longDiff;
        }

        balance = balance > 0 ? balance : 0;
    }

    function _reduceAuthorizedTokens(int256 currentNav) internal returns (bool didReduce) {
        int256 totalAuthorizedNav = currentNav + int256(additionalAuthorizedNav);
        int256 reqMargin = _getRequiredEthMargin(provider, totalAuthorizedNav);
        int256 providerBalance = provider.balance;

        if (reqMargin > providerBalance) {
            // Not enough margin to maintain additionalAuthorizedNav
            int256 navCap = (providerBalance * 1 ether) / int256(provider.marginRequirement);
            assert(navCap > currentNav);
            additionalAuthorizedNav = uint(navCap - currentNav);
            return true;
        }

        return false;
    }

    function _getDefaultPenaltyEth() internal view returns (int256 penalty) {
        return _takePercentage(nav, defaultPenalty);
    }

    function _tokensFromNav(int256 currentNav, int256 unitNav) internal pure returns (int256 numTokens) {
        return (currentNav * 1 ether) / unitNav;
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(1 ether);
    }

    function _takePercentage(int256 value, uint percentage) private pure returns (int256 result) {
        return (value * int256(percentage)) / 1 ether;
    }
}


contract SimpleTokenizedDerivative is TokenizedDerivative {

    constructor(
        address _providerAddress,
        address _investorAddress,
        address _oracleAddress,
        uint _defaultPenalty, // Percentage of nav*10^18
        uint _providerRequiredMargin, // Percentage of nav*10^18
        string _product,
        uint _fixedYearlyFee, // Percentage of nav * 10^18
        uint _disputeDeposit // Percentage of nav * 10^18
    ) public payable TokenizedDerivative(
        _providerAddress,
        _investorAddress,
        _oracleAddress,
        _defaultPenalty,
        _providerRequiredMargin,
        _product,
        _fixedYearlyFee,
        _disputeDeposit
    ) {} // solhint-disable-line no-empty-blocks

    function computeUnitNav(int256 oraclePrice) public view returns (int256 unitNav) {
        // This could be more complex, but in our case, just return the oracle value.
        return oraclePrice;
    }

    function initialUnitNav(int256 oraclePrice) public view returns (int256 unitNav) {
        return computeUnitNav(oraclePrice);
    }

}


contract TokenizedDerivativeCreator is ContractCreator {
    constructor(address registryAddress, address _oracleAddress)
        public
        ContractCreator(registryAddress, _oracleAddress) {} // solhint-disable-line no-empty-blocks

    function createTokenizedDerivative(
        address provider,
        address investor,
        uint defaultPenalty,
        uint providerRequiredMargin,
        string product,
        uint fixedYearlyFee,
        uint disputeDeposit
    )
        external
        returns (address derivativeAddress)
    {

        SimpleTokenizedDerivative derivative = new SimpleTokenizedDerivative(
            provider,
            investor,
            oracleAddress,
            defaultPenalty,
            providerRequiredMargin,
            product,
            fixedYearlyFee,
            disputeDeposit
        );

        _registerNewContract(provider, investor, address(derivative));

        return address(derivative);
    }
}
