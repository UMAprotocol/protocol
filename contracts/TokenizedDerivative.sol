/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./ContractCreator.sol";
import "./OracleInterface.sol";
import "./PriceFeedInterface.sol";
import "./V2OracleInterface.sol";


contract ReturnCalculator {
    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn);
}


contract Leveraged2x is ReturnCalculator {
    using SafeMath for int;

    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn) {
        // Compute the underlying asset return: +1% would be 1.01 (* 1 ether).
        int underlyingAssetReturn = newOraclePrice.mul(1 ether).div(oldOraclePrice);

        // Compute the RoR of the underlying asset and multiply by 2 to add the leverage.
        int leveragedRor = underlyingAssetReturn.sub(1 ether).mul(2);

        // Add 1 (ether) to the leveraged RoR to get the return.
        return leveragedRor.add(1 ether);
    }
}


contract NoLeverage is ReturnCalculator {
    using SafeMath for int;

    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn) {
        return newOraclePrice.mul(1 ether).div(oldOraclePrice);
    }
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20 {
    using SafeMath for uint;
    using SafeMath for int;

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
        address payable accountAddress;
        int balance;
        bool hasConfirmedPrice;
        uint marginRequirement; // Percentage of nav*10^18
    }

    // Note: these variables are to give ERC20 consumers information about the token.
    string public constant name = "2x Levered Bitcoin-Ether"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "2XBCE"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    // Financial information
    uint public defaultPenalty; // Percentage of nav*10^18
    bytes32 public product;

    // Other addresses/contracts
    ContractParty public provider;
    ContractParty public investor;
    V2OracleInterface public v2Oracle;
    PriceFeedInterface public priceFeed;
    ReturnCalculator public returnCalculator;

    State public state;
    uint public endTime;
    uint public disputeDeposit;

    // The state of the token at a particular time. The state gets updated on remargin.
    struct TokenState {
        int underlyingPrice;
        int tokenPrice;
        uint time;
    }

    // The NAV of the contract always reflects the transition from (`prev`, `current`).
    // In the case of a remargin, a `latest` price is retrieved from the price feed, and we shift `current` -> `prev`
    // and `latest` -> `current` (and then recompute).
    // In the case of a dispute, `current` might change (which is why we have to hold on to `prev`).
    TokenState public prevTokenState;
    TokenState public currentTokenState;

    int public nav;  // Net asset value is measured in Wei

    uint public additionalAuthorizedNav;

    uint public fixedFeePerSecond;

    // The information in the following struct is only valid if in the midst of a Dispute.
    struct Dispute {
        int disputedNav;
        address disputer;
        uint deposit;
    }

    Dispute public disputeInfo;

    // Only valid if in the midst of a Default.
    int public navAtDefault;

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
        address payable _providerAddress,
        address payable _investorAddress,
        address _v2OracleAddress,
        address _priceFeedAddress,
        uint _defaultPenalty, // Percentage of nav*10^18
        uint _providerRequiredMargin, // Percentage of nav*10^18
        bytes32 _product,
        uint _fixedYearlyFee, // Percentage of nav * 10^18
        uint _disputeDeposit, // Percentage of nav * 10^18
        address _returnCalculator,
        uint _startingTokenPrice,
        uint expiry
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(_defaultPenalty <= _providerRequiredMargin);
        require(_providerRequiredMargin <= 1 ether);
        
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(_startingTokenPrice >= uint(1 ether).div(10**9));
        require(_startingTokenPrice <= uint(1 ether).mul(10**9));

        // Address information
        v2Oracle = V2OracleInterface(_v2OracleAddress);
        priceFeed = PriceFeedInterface(_priceFeedAddress);
        // Verify that the price feed and oracle support the given product.
        require(v2Oracle.isSymbolSupported(_product));
        require(priceFeed.isSymbolSupported(_product));

        provider = ContractParty(_providerAddress, 0, false, _providerRequiredMargin);
        // Note: the investor is required to have 100% margin at all times.
        investor = ContractParty(_investorAddress, 0, false, 1 ether);

        returnCalculator = ReturnCalculator(_returnCalculator);

        // Contract parameters.
        defaultPenalty = _defaultPenalty;
        product = _product;
        fixedFeePerSecond = _fixedYearlyFee.div(SECONDS_PER_YEAR);
        disputeDeposit = _disputeDeposit;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint latestTime, int latestUnderlyingPrice) = priceFeed.latestPrice(product);
        require(latestTime != 0);

        // Set end time to max value of uint to implement no expiry.
        if (expiry == 0) {
            endTime = ~uint(0);
        } else {
            require(expiry >= latestTime);
            endTime = expiry;
        }

        nav = _computeInitialNav(latestUnderlyingPrice, latestTime, _startingTokenPrice);

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

        // Verify that remargining didn't push the contract into expiry or default.
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
        investor.balance = investor.balance.add(int(navToPurchase));

        _mint(msg.sender, uint(_tokensFromNav(int(navToPurchase), currentTokenState.tokenPrice)));

        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

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

        require(this.transferFrom(msg.sender, address(this), numTokens));
        _burn(address(this), numTokens);


        int investorBalance = investor.balance;
        assert(investorBalance >= 0);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(investorBalance), tokenPercentage);

        investor.balance = investor.balance.sub(int(tokenValue));
        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

        msg.sender.transfer(tokenValue);
    }

    function dispute() external payable onlyContractParties {
        require(
            state == State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(nav, disputeDeposit));

        require(msg.value >= requiredDeposit);
        uint refund = msg.value - requiredDeposit;

        state = State.Disputed;
        endTime = currentTokenState.time;
        disputeInfo.disputedNav = nav;
        disputeInfo.disputer = msg.sender;
        disputeInfo.deposit = requiredDeposit;

        _requestOraclePrice(endTime);

        msg.sender.transfer(refund);
    }

    function withdraw(uint amount) external payable onlyProvider {
        // Make sure either in Live or Settled.
        require(state == State.Live || state == State.Settled);

        // Remargin before allowing a withdrawal, but only if in the live state.
        if (state == State.Live) {
            remargin();
        }

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states.
        int withdrawableAmount = (state == State.Settled) ?
            provider.balance :
            provider.balance - _getRequiredEthMargin(provider, nav);

        // Can only withdraw the allowed amount.
        require(
            int(withdrawableAmount) >= int(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        provider.balance = provider.balance.sub(int(amount));
        provider.accountAddress.transfer(amount);
    }

    function settle() public {
        State startingState = state;
        require(startingState == State.Disputed || startingState == State.Expired || startingState == State.Defaulted);
        _settleVerifiedPrice();
        if (startingState == State.Disputed) {
            (ContractParty storage disputer, ContractParty storage notDisputer) = _whoAmI(disputeInfo.disputer);
            int depositValue = int(disputeInfo.deposit);
            if (nav == disputeInfo.disputedNav) {
                disputer.balance = disputer.balance.add(depositValue);
            } else {
                notDisputer.balance = notDisputer.balance.add(depositValue);
            }
        }
    }

    function confirmPrice() public onlyContractParties {
        // Right now, only confirming prices in the defaulted state.
        require(state == State.Defaulted);

        if (msg.sender == provider.accountAddress) {
            provider.hasConfirmedPrice = true;
        }

        if (msg.sender == investor.accountAddress) {
            investor.hasConfirmedPrice = true;
        }

        // If both have confirmed then advance state to settled.
        // Should add some kind of a time check here -- If both have confirmed or one confirmed and sufficient time
        // passes then we want to settle and remargin.
        if (provider.hasConfirmedPrice && investor.hasConfirmedPrice) {
            // Remargin on agreed upon price.
            _settleAgreedPrice();
        }
    }

    function deposit() public payable onlyProvider {
        // Only allow the provider to deposit margin.

        // Make sure that one of participants is sending the deposit and that
        // we are in a "depositable" state.
        require(state == State.Live);
        provider.balance = provider.balance.add(int(msg.value));
    }

    function remargin() public {
        // If the state is not live, remargining does not make sense.
        require(state == State.Live);

        // Checks whether contract has ended.
        (uint latestTime, int latestPrice) = priceFeed.latestPrice(product);
        require(latestTime != 0);
        if (latestTime >= endTime) {
            state = State.Expired;
            prevTokenState = currentTokenState;
            // We have no idea what the price was, exactly at endTime, so we can't set
            // currentTokenState, or update the nav, or do anything.
            _requestOraclePrice(endTime);
            return;
        }

        // Update nav of contract.
        int newNav = _computeNav(latestPrice, latestTime);
        bool inDefault = _remargin(newNav, latestTime);
        _reduceAuthorizedTokens(newNav);

        if (inDefault) {
            _requestOraclePrice(endTime);
        }
    }

    // TODO: Think about a cleaner way to do this -- It's ugly because we're leveraging the "ContractParty" struct in
    //       every other place and here we're returning addresses. We probably want a nice public method that returns
    //       something intuitive and an internal method that's a little easier to use inside the contract, but messier
    //       for outside.
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

    function _getRequiredEthMargin(ContractParty storage party, int currentNav)
        internal
        view
        returns (int requiredEthMargin)
    {
        return _takePercentage(currentNav, party.marginRequirement);
    }

    function _isDefault(ContractParty storage party) internal view returns (bool) {
        return party.balance < _getRequiredEthMargin(party, nav);
    }

    function _whoAmI(address sender)
        internal
        view
        returns (ContractParty storage senderParty, ContractParty storage otherParty)
    {
        bool senderIsProvider = (sender == provider.accountAddress);
        bool senderIsInvestor = (sender == investor.accountAddress);
        require(senderIsProvider || senderIsInvestor); // At least one should be true

        return senderIsProvider ? (provider, investor) : (investor, provider);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int price) internal {

        // Remargin at whatever price we're using (verified or unverified).
        _updateBalances(_recomputeNav(price, endTime));

        // Check whether anyone goes into default.
        (bool inDefault, address _defaulter, ) = whoDefaults();

        if (inDefault) {
            (ContractParty storage defaulter, ContractParty storage notDefaulter) = _whoAmI(_defaulter);
            int penalty;
            int expectedDefaultPenalty = _getDefaultPenaltyEth();
            penalty = (defaulter.balance < expectedDefaultPenalty) ?
                defaulter.balance :
                expectedDefaultPenalty;

            defaulter.balance = defaulter.balance.sub(penalty);
            notDefaulter.balance = notDefaulter.balance.add(penalty);
        }

        state = State.Settled;
    }

    function _settleAgreedPrice() internal {
        int agreedPrice = currentTokenState.underlyingPrice;

        _settle(agreedPrice);
    }

    function _settleVerifiedPrice() internal {
        (uint timeForPrice, int oraclePrice, ) = v2Oracle.getPrice(product, endTime);
        require(timeForPrice != 0);

        _settle(oraclePrice);
    }

    // Remargins the account based on a provided NAV value.
    // The internal remargin method allows certain calls into the contract to
    // automatically remargin to non-current NAV values (time of expiry, last
    // agreed upon price, etc).
    function _remargin(int navNew, uint latestTime) internal returns (bool inDefault) {
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = nav;

        // Update the balances of the contract.
        _updateBalances(navNew);

        // Make sure contract has not moved into default.
        (inDefault, , ) = whoDefaults();
        if (inDefault) {
            state = State.Defaulted;
            navAtDefault = previousNav;
            endTime = latestTime; // Change end time to moment when default occurred.
        }
    }

    function _updateBalances(int navNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = _getLongNavDiff(navNew);
        nav = navNew;

        investor.balance = investor.balance.add(longDiff);
        provider.balance = provider.balance.sub(longDiff);
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongNavDiff(int navNew) internal view returns (int longNavDiff) {
        return navNew.sub(nav);
    }

    function _reduceAuthorizedTokens(int currentNav) internal returns (bool didReduce) {
        if (state != State.Live) {
            didReduce = additionalAuthorizedNav != 0;
            additionalAuthorizedNav = 0;
            return didReduce;
        }

        int totalAuthorizedNav = currentNav.add(int(additionalAuthorizedNav));
        int requiredMargin = _getRequiredEthMargin(provider, totalAuthorizedNav);
        int providerBalance = provider.balance;

        if (requiredMargin > providerBalance) {
            // Not enough margin to maintain additionalAuthorizedNav.
            int navCap = providerBalance.mul(1 ether).div(int(provider.marginRequirement));
            assert(navCap > currentNav);
            additionalAuthorizedNav = uint(navCap.sub(currentNav));
            return true;
        }

        return false;
    }

    function _getDefaultPenaltyEth() internal view returns (int penalty) {
        return _takePercentage(navAtDefault, defaultPenalty);
    }

    function _tokensFromNav(int currentNav, int unitNav) internal pure returns (int numTokens) {
        if (unitNav <= 0) {
            return 0;
        } else {
            return currentNav.mul(1 ether).div(unitNav);
        }
    }

    function _computeNav(int latestUnderlyingPrice, uint latestTime) private returns (int navNew) {
        prevTokenState = currentTokenState;
        currentTokenState = _computeNewTokenState(currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(currentTokenState.tokenPrice);
    }

    function _recomputeNav(int oraclePrice, uint recomputeTime) private returns (int navNew) {
        // We're updating `last` based on what the Oracle has told us.
        // TODO(ptare): Add ability for the Oracle to correct the time as well.
        assert(endTime == recomputeTime);
        currentTokenState = _computeNewTokenState(prevTokenState, oraclePrice, recomputeTime);
        navNew = _computeNavFromTokenPrice(currentTokenState.tokenPrice);
    }

    function _computeInitialNav(int latestUnderlyingPrice, uint latestTime, uint startingTokenPrice)
        private
        returns (int navNew) {
            int unitNav = int(startingTokenPrice);
            prevTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            currentTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            navNew = _computeNavFromTokenPrice(unitNav);
        }

    function _requestOraclePrice(uint requestedTime) private {
        (uint time, , ) = v2Oracle.getPrice(product, requestedTime);
        if (time != 0) {
            // The Oracle price is already available, settle the contract right away.
            settle();
        }
    }

    function _computeNewTokenState(
        TokenState storage beginningTokenState, int latestUnderlyingPrice, uint recomputeTime)
        private
        view
        returns (TokenState memory newTokenState) {
            int underlyingReturn = returnCalculator.computeReturn(
                beginningTokenState.underlyingPrice, latestUnderlyingPrice);
            int tokenReturn = underlyingReturn.sub(
                int(fixedFeePerSecond.mul(recomputeTime.sub(beginningTokenState.time))));
            int newTokenPrice = 0;
            if (tokenReturn > 0) {
                newTokenPrice = _takePercentage(prevTokenState.tokenPrice, uint(tokenReturn));
            }
            newTokenState = TokenState(latestUnderlyingPrice, newTokenPrice, recomputeTime);
        }

    function _computeNavFromTokenPrice(int tokenPrice) private view returns (int navNew) {
        navNew = int(totalSupply()).mul(tokenPrice).div(1 ether);
        assert(navNew >= 0);
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(1 ether);
    }

    function _takePercentage(int value, uint percentage) private pure returns (int result) {
        return value.mul(int(percentage)).div(1 ether);
    }
}


contract TokenizedDerivativeCreator is ContractCreator {
    constructor(address registryAddress, address _oracleAddress, address _v2OracleAddress, address _priceFeedAddress)
        public
        ContractCreator(registryAddress, _oracleAddress,
                        _v2OracleAddress, _priceFeedAddress) {} // solhint-disable-line no-empty-blocks

    function createTokenizedDerivative(
        address payable provider,
        address payable investor,
        uint defaultPenalty,
        uint providerRequiredMargin,
        bytes32 product,
        uint fixedYearlyFee,
        uint disputeDeposit,
        address returnCalculator,
        uint startingTokenPrice,
        uint expiry
    )
        external
        returns (address derivativeAddress)
    {
        TokenizedDerivative derivative = new TokenizedDerivative(
            provider,
            investor,
            v2OracleAddress,
            priceFeedAddress,
            defaultPenalty,
            providerRequiredMargin,
            product,
            fixedYearlyFee,
            disputeDeposit,
            returnCalculator,
            startingTokenPrice,
            expiry
        );

        _registerNewContract(provider, investor, address(derivative));

        return address(derivative);
    }
}
