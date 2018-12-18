/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity >=0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./OracleInterface.sol";
import "./ContractCreator.sol";


contract ReturnCalculator {
    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn);
}


contract Leveraged2x is ReturnCalculator {
    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn) {
        return ((((newOraclePrice * (1 ether)) / oldOraclePrice) - 1 ether) * 2) + 1 ether;
    }
}


contract NoLeverage is ReturnCalculator {
    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn) {
        return (newOraclePrice * (1 ether)) / oldOraclePrice;
    }
}


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

        // The contract has been terminated by one party. That party can no longer dispute the price, but the other
        // party can. If a dispute occurs, the termination fee is refunded to the sender.
        // Possible state transitions: Disputed, Settled.
        Terminated,

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

    // Note: these variables are to give ERC20 consumers information about the token.
    string public constant name = "2x Levered Bitcoin-Ether"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "2XBCE"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    // Financial information
    uint public defaultPenalty; // Percentage of nav*10^18
    uint public terminationFee; // Percentage of nav*10^18
    string public product;

    // Other addresses/contracts
    ContractParty public provider;
    ContractParty public investor;
    OracleInterface public oracle;
    ReturnCalculator public returnCalculator;

    State public state;
    uint public endTime;
    uint public lastRemarginTime;
    uint public disputeDeposit;

    // TODO(mrice32): try to remove these previous variables as they are a gas hog.
    int public prevUnderlyingPrice;
    int public prevTokenPrice;
    uint public prevRemarginTime;

    int256 public tokenPrice;
    int256 public underlyingPrice;
    int256 public nav;  // Net asset value is measured in Wei

    uint public additionalAuthorizedNav;

    uint public fixedFeePerSecond;

    // The information in the following struct is only valid if in the midst of a Dispute.
    struct Dispute {
        int256 disputedNav;
        address disputer;
        uint deposit;
    }

    Dispute public dispute;

    // The information in the following struct is only valid if in the midst of a Default or Termination.
    struct Termination {
        int nav;
        // Note: the following fields are only valid if being terminated voluntarily without default.
        address terminator;
        uint fee;
    }

    Termination public termination;

    uint public constant SECONDS_PER_YEAR = 31536000;

    modifier onlyContractParties {
        require(msg.sender == provider.accountAddress || msg.sender == investor.accountAddress);
        _;
    }

    modifier onlyInvestor {
        require(msg.sender == investor.accountAddress);
        _;
    }

    modifier onlyProvider {
        require(msg.sender == provider.accountAddress);
        _;
    }

    constructor(
        address _providerAddress,
        address _investorAddress,
        address _oracleAddress,
        uint _defaultPenalty, // Percentage of nav*10^18
        uint _terminationFee, // Percentage of nav*10^18
        uint _providerRequiredMargin, // Percentage of nav*10^18
        string _product,
        uint _fixedYearlyFee, // Percentage of nav * 10^18
        uint _disputeDeposit, // Percentage of nav * 10^18
        address _returnCalculator,
        uint _startingTokenPrice
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(_defaultPenalty <= _providerRequiredMargin);
        require(_providerRequiredMargin <= 1 ether);
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(_startingTokenPrice >= (1 ether / (10**9)));
        require(_startingTokenPrice <= (1 ether * (10**9)));

        // Address information
        oracle = OracleInterface(_oracleAddress);
        provider = ContractParty(_providerAddress, 0, false, _providerRequiredMargin);

        // Note: the investor is required to have 100% margin at all times.
        investor = ContractParty(_investorAddress, 0, false, 1 ether);

        returnCalculator = ReturnCalculator(_returnCalculator);

        // Contract states
        lastRemarginTime = 0;
        defaultPenalty = _defaultPenalty;
        product = _product;
        fixedFeePerSecond = _fixedYearlyFee / SECONDS_PER_YEAR;
        disputeDeposit = _disputeDeposit;
        terminationFee = _terminationFee;

        // Set end time to max value of uint to implement no expiry.
        endTime = ~uint(0);


        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint currentTime, int oraclePrice) = oracle.latestUnverifiedPrice();
        require(currentTime != 0);
        
        nav = initialNav(oraclePrice, currentTime, _startingTokenPrice);

        state = State.Live;
    }

    function authorizeTokens(uint newAuthorizedNavInWei) external payable onlyProvider {
        deposit();
        remargin();

        require(state == State.Live);

        additionalAuthorizedNav = additionalAuthorizedNav.add(newAuthorizedNavInWei);
        require(!_reduceAuthorizedTokens(nav));
    }

    function createTokens(bool exact) external payable onlyInvestor {
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

        additionalAuthorizedNav = authorizedNav.sub(navToPurchase);
        investor.balance += int256(navToPurchase);

        _mint(msg.sender, uint(_tokensFromNav(int256(navToPurchase), tokenPrice)));

        nav = (int(totalSupply()) * tokenPrice) / 1 ether;

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

        uint initialSupply = totalSupply();

        require(this.transferFrom(msg.sender, this, numTokens));
        _burn(this, numTokens);


        int256 investorBalance = investor.balance;
        assert(investorBalance >= 0);


        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(investorBalance), tokenPercentage);

        investor.balance -= int256(tokenValue);
        nav = (int(totalSupply()) * tokenPrice) / 1 ether;

        msg.sender.transfer(tokenValue);
    }

    function confirmPrice() public onlyContractParties {
        // Right now, only dispute if in a pre-settlement state
        require(state == State.Expired || state == State.Defaulted || state == State.Terminated);

        if (msg.sender == provider.accountAddress) {
            provider.hasConfirmedPrice = true;
        }

        if (msg.sender == investor.accountAddress) {
            investor.hasConfirmedPrice = true;
        }

        // If both have confirmed then advance state to settled
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin
        if (provider.hasConfirmedPrice && investor.hasConfirmedPrice) {
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
            state == State.Live,
            "Contract must be Live to dispute"
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

        // Update nav of contract

        int256 newNav = computeNav(oraclePrice, currentTime);
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
                disputer.balance += depositValue;
            } else {
                notDisputer.balance += depositValue;
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

    function terminate() public payable onlyContractParties {
        int terminationNav = nav;

        remargin();

        require(state == State.Live);

        uint requiredDeposit = uint(_takePercentage(terminationNav, terminationFee));

        require(msg.value >= requiredDeposit);
        uint refund = msg.value - requiredDeposit;

        termination.nav = terminationNav;
        termination.fee = requiredDeposit;
        termination.terminator = msg.sender;

        state = State.Terminated;
        endTime = lastRemarginTime;

        confirmPrice();

        msg.sender.transfer(refund);
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
        _updateBalances(recomputeNav(price, endTime));

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

        int termFee = int(termination.fee);

        if (termFee > 0) {
            (, ContractParty storage notTerminator) = _whoAmI(termination.terminator);
            notTerminator.balance += termFee;
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
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = nav;

        // Update the balances of contract
        _updateBalances(navNew);

        // Make sure contract has not moved into default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();
        if (inDefault) {
            state = State.Defaulted;
            termination.nav = previousNav;

            // TODO(mrice32): Pass in the current time rather than querying it.
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

    function _reduceAuthorizedTokens(int256 currentNav) internal returns (bool didReduce) {
        if (state != State.Live) {
            didReduce = additionalAuthorizedNav != 0;
            additionalAuthorizedNav = 0;
            return;
        }

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
        return _takePercentage(termination.nav, defaultPenalty);
    }

    function _tokensFromNav(int256 currentNav, int256 unitNav) internal pure returns (int256 numTokens) {
        if (unitNav <= 0) {
            return 0;
        } else {
            return (currentNav * 1 ether) / unitNav;
        }
    }

    function computeNav(int256 oraclePrice, uint currentTime) private returns (int256 navNew) {
        int underlyingReturn = returnCalculator.computeReturn(underlyingPrice, oraclePrice);
        int tokenReturn = underlyingReturn - int(fixedFeePerSecond.mul(currentTime.sub(lastRemarginTime)));
        int newTokenPrice = 0;
        if (tokenReturn > 0) {
            newTokenPrice = _takePercentage(tokenPrice, uint(tokenReturn));
        }
        navNew = (int(totalSupply()) * newTokenPrice) / 1 ether;
        assert(navNew >= 0);
        prevUnderlyingPrice = underlyingPrice;
        underlyingPrice = oraclePrice;
        prevTokenPrice = tokenPrice;
        tokenPrice = newTokenPrice;
        prevRemarginTime = lastRemarginTime;
        lastRemarginTime = currentTime;
    }

    // TODO(mrice32): make "old state" and "new state" a storage argument to combine this and computeNav.
    function recomputeNav(int256 oraclePrice, uint currentTime) private returns (int navNew) {
        assert(lastRemarginTime == currentTime);
        int underlyingReturn = returnCalculator.computeReturn(prevUnderlyingPrice, oraclePrice);
        int tokenReturn = underlyingReturn - int(fixedFeePerSecond.mul(currentTime.sub(prevRemarginTime)));
        int newTokenPrice = 0;
        if (tokenReturn > 0) {
            newTokenPrice = _takePercentage(prevTokenPrice, uint(tokenReturn));
        }
        navNew = (int(totalSupply()) * newTokenPrice) / 1 ether;
        assert(navNew >= 0);
        underlyingPrice = oraclePrice;
        tokenPrice = newTokenPrice;
        lastRemarginTime = currentTime;
    }

    function initialNav(int256 oraclePrice, uint currentTime, uint startingPrice) private returns (int256 navNew) {
        int unitNav = int(startingPrice);
        lastRemarginTime = currentTime;
        prevRemarginTime = currentTime;
        tokenPrice = unitNav;
        prevTokenPrice = unitNav;
        underlyingPrice = oraclePrice;
        prevUnderlyingPrice = oraclePrice;
        navNew = (int(totalSupply()) * unitNav) / 1 ether;
        assert(navNew >= 0);
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(1 ether);
    }

    function _takePercentage(int256 value, uint percentage) private pure returns (int256 result) {
        return (value * int256(percentage)) / 1 ether;
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
        uint terminationFee,
        uint providerRequiredMargin,
        string product,
        uint fixedYearlyFee,
        uint disputeDeposit,
        address returnCalculator,
        uint startingTokenPrice
    )
        external
        returns (address derivativeAddress)
    {
        TokenizedDerivative derivative = new TokenizedDerivative(
            provider,
            investor,
            oracleAddress,
            defaultPenalty,
            terminationFee,
            providerRequiredMargin,
            product,
            fixedYearlyFee,
            disputeDeposit,
            returnCalculator,
            startingTokenPrice
        );

        _registerNewContract(provider, investor, address(derivative));

        return address(derivative);
    }
}
