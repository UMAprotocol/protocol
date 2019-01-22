/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "./ContractCreator.sol";
import "./PriceFeedInterface.sol";
import "./V2OracleInterface.sol";


contract ReturnCalculator {
    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn);
}


contract Leveraged2x is ReturnCalculator {
    using SignedSafeMath for int;

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
    using SignedSafeMath for int;

    function computeReturn(int oldOraclePrice, int newOraclePrice) external view returns (int assetReturn) {
        return newOraclePrice.mul(1 ether).div(oldOraclePrice);
    }
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20 {
    using SafeMath for uint;
    using SignedSafeMath for int;

    enum State {
        // The contract is active, and tokens can be created and redeemed. Margin can be added and withdrawn (as long as
        // it exceeds required levels). Remargining is allowed. Created contracts immediately begin in this state.
        // Possible state transitions: Disputed, Expired, Defaulted.
        Live,

        // Disputed, Expired, and Defaulted are Frozen states. In a Frozen state, the contract is frozen in time
        // awaiting a resolution by the Oracle. No tokens can be created or redeemed. Margin cannot be withdrawn. The
        // resolution of these states moves the contract to the Settled state. Remargining is not allowed.

        // The sponsor has disputed the price feed output. If the dispute is valid (i.e., the NAV calculated from the
        // Oracle price differs from the NAV calculated from the price feed), the dispute fee is added to the short
        // account. Otherwise, the dispute fee is added to the long margin account.
        // Possible state transitions: Settled.
        Disputed,

        // Contract expiration has been reached.
        // Possible state transitions: Settled.
        Expired,

        // The short margin account is below its margin requirement. The sponsor can choose to confirm the default and
        // move to Settle without waiting for the Oracle. Default penalties will be assessed when the contract moves to
        // Settled.
        // Possible state transitions: Settled.
        Defaulted,

        // Token price is fixed. Tokens can be redeemed by anyone. All short margin can be withdrawn. Tokens can't be
        // created, and contract can't remargin.
        // Possible state transitions: None.
        Settled
    }

    // Note: these variables are to give ERC20 consumers information about the token.
    string public constant name = "2x Levered Bitcoin-Ether"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "2XBCE"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    // Fixed contract parameters.
    uint public defaultPenalty; // Percentage of nav*10^18
    uint public marginRequirement; // Percentage of nav*10^18
    uint public disputeDeposit; // Percentage of nav*10^18
    uint public fixedFeePerSecond; // Percentage of nav*10^18
    bytes32 public product;

    // Balances
    int public shortBalance;
    int public longBalance;

    // Other addresses/contracts
    address public sponsor;
    address public admin;
    V2OracleInterface public v2Oracle;
    PriceFeedInterface public priceFeed;
    ReturnCalculator public returnCalculator;

    State public state;
    uint public endTime;

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

    // The information in the following struct is only valid if in the midst of a Dispute.
    struct Dispute {
        int disputedNav;
        uint deposit;
    }

    Dispute public disputeInfo;

    // Only valid if in the midst of a Default.
    int public navAtDefault;

    uint public constant SECONDS_PER_YEAR = 31536000;

    modifier onlySponsor {
        require(msg.sender == sponsor);
        _;
    }

    modifier onlyAdmin {
        require(msg.sender == admin);
        _;
    }

    modifier onlySponsorOrAdmin {
        require(msg.sender == sponsor || msg.sender == admin);
        _;
    }

    constructor(
        address _sponsorAddress,
        address _adminAddress,
        address _v2OracleAddress,
        address _priceFeedAddress,
        uint _defaultPenalty, // Percentage of nav*10^18
        uint _requiredMargin, // Percentage of nav*10^18
        bytes32 _product,
        uint _fixedYearlyFee, // Percentage of nav * 10^18
        uint _disputeDeposit, // Percentage of nav * 10^18
        address _returnCalculator,
        uint _startingTokenPrice,
        uint expiry
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(_defaultPenalty <= _requiredMargin);
        require(_requiredMargin <= 1 ether);
        marginRequirement = _requiredMargin;
        
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(_startingTokenPrice >= uint(1 ether).div(10**9));
        require(_startingTokenPrice <= uint(1 ether).mul(10**9));

        // Address information
        v2Oracle = V2OracleInterface(_v2OracleAddress);
        priceFeed = PriceFeedInterface(_priceFeedAddress);
        // Verify that the price feed and oracle support the given product.
        require(v2Oracle.isIdentifierSupported(_product));
        require(priceFeed.isIdentifierSupported(_product));

        sponsor = _sponsorAddress;
        admin = _adminAddress;
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

    function createTokens() external payable onlySponsor {
        _createTokens(msg.value);
    }

    function depositAndCreateTokens(uint newTokenNav) external payable onlySponsor {
        // Subtract newTokenNav from amount sent.
        uint depositAmount = msg.value.sub(newTokenNav);

        // Deposit additional margin into the short account.
        _deposit(depositAmount);

        // Create new newTokenNav worth of tokens.
        _createTokens(newTokenNav);
    }

    function redeemTokens() external {
        require((msg.sender == sponsor && state == State.Live) || state == State.Settled);

        if (state == State.Live) {
            remargin();
        }

        uint initialSupply = totalSupply();

        uint numTokens = _pullAllAuthorizedTokens(this);
        require(numTokens > 0);
        _burn(address(this), numTokens);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        assert(longBalance >= 0);
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(longBalance), tokenPercentage);

        longBalance = longBalance.sub(int(tokenValue));
        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

        msg.sender.transfer(tokenValue);
    }

    function dispute() external payable onlySponsor {
        require(
            state == State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(nav, disputeDeposit));

        require(msg.value >= requiredDeposit);
        uint refund = msg.value.sub(requiredDeposit);

        state = State.Disputed;
        endTime = currentTokenState.time;
        disputeInfo.disputedNav = nav;
        disputeInfo.deposit = requiredDeposit;

        _requestOraclePrice(endTime);

        msg.sender.transfer(refund);
    }

    function withdraw(uint amount) external onlySponsor {
        // Remargin before allowing a withdrawal, but only if in the live state.
        if (state == State.Live) {
            remargin();
        }

        // Make sure either in Live or Settled after any necessary remargin.
        require(state == State.Live || state == State.Settled);

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states.
        int withdrawableAmount = (state == State.Settled) ?
            shortBalance :
            shortBalance.sub(_getRequiredEthMargin(nav));

        // Can only withdraw the allowed amount.
        require(
            withdrawableAmount >= int(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        shortBalance = shortBalance.sub(int(amount));
        msg.sender.transfer(amount);
    }

    function settle() public {
        State startingState = state;
        require(startingState == State.Disputed || startingState == State.Expired || startingState == State.Defaulted);
        _settleVerifiedPrice();
        if (startingState == State.Disputed) {
            int depositValue = int(disputeInfo.deposit);
            if (nav != disputeInfo.disputedNav) {
                shortBalance = shortBalance.add(depositValue);
            } else {
                longBalance = longBalance.add(depositValue);
            }
        }
    }

    function confirmPrice() public onlySponsor {
        // Right now, only confirming prices in the defaulted state.
        require(state == State.Defaulted);

        // Remargin on agreed upon price.
        _settleAgreedPrice();
    }

    function deposit() public payable onlySponsor {
        // Only allow the sponsor to deposit margin.
        _deposit(msg.value);
    }

    function remargin() public onlySponsorOrAdmin {
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

        if (inDefault) {
            _requestOraclePrice(endTime);
        }
    }

    function _createTokens(uint navToPurchase) private {
        remargin();

        // Verify that remargining didn't push the contract into expiry or default.
        require(state == State.Live);

        longBalance = longBalance.add(int(navToPurchase));

        _mint(msg.sender, uint(_tokensFromNav(int(navToPurchase), currentTokenState.tokenPrice)));

        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

        // Make sure this still satisfies the margin requirement.
        require(_satisfiesMarginRequirement(shortBalance, nav));
    }

    function _deposit(uint value) private {
        // Make sure that we are in a "depositable" state.
        require(state == State.Live);
        shortBalance = shortBalance.add(int(value));
    }

    function _getRequiredEthMargin(int currentNav)
        private
        view
        returns (int requiredEthMargin)
    {
        return _takePercentage(currentNav, marginRequirement);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int price) private {

        // Remargin at whatever price we're using (verified or unverified).
        _updateBalances(_recomputeNav(price, endTime));

        bool inDefault = !_satisfiesMarginRequirement(shortBalance, nav);

        if (inDefault) {
            int expectedDefaultPenalty = _getDefaultPenaltyEth();
            int penalty = (shortBalance < expectedDefaultPenalty) ?
                shortBalance :
                expectedDefaultPenalty;

            shortBalance = shortBalance.sub(penalty);
            longBalance = longBalance.add(penalty);
        }

        state = State.Settled;
    }

    function _settleAgreedPrice() private {
        int agreedPrice = currentTokenState.underlyingPrice;

        _settle(agreedPrice);
    }

    function _settleVerifiedPrice() private {
        (uint timeForPrice, int oraclePrice, ) = v2Oracle.getPrice(product, endTime);
        require(timeForPrice != 0);

        _settle(oraclePrice);
    }

    // Remargins the account based on a provided NAV value.
    // The internal remargin method allows certain calls into the contract to
    // automatically remargin to non-current NAV values (time of expiry, last
    // agreed upon price, etc).
    function _remargin(int navNew, uint latestTime) private returns (bool inDefault) {
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = nav;

        // Update the balances of the contract.
        _updateBalances(navNew);

        // Make sure contract has not moved into default.
        inDefault = !_satisfiesMarginRequirement(shortBalance, nav);
        if (inDefault) {
            state = State.Defaulted;
            navAtDefault = previousNav;
            endTime = latestTime; // Change end time to moment when default occurred.
        }
    }

    function _updateBalances(int navNew) private {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = _getLongNavDiff(navNew);
        nav = navNew;

        longBalance = longBalance.add(longDiff);
        shortBalance = shortBalance.sub(longDiff);
    }

    function _satisfiesMarginRequirement(int balance, int currentNav)
        private
        view
        returns (bool doesSatisfyRequirement) 
    {
        return _getRequiredEthMargin(currentNav) <= balance;
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongNavDiff(int navNew) private view returns (int longNavDiff) {
        return navNew.sub(nav);
    }

    function _getDefaultPenaltyEth() private view returns (int penalty) {
        return _takePercentage(navAtDefault, defaultPenalty);
    }

    function _tokensFromNav(int currentNav, int unitNav) private pure returns (int numTokens) {
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

    function _pullAllAuthorizedTokens(IERC20 erc20) private returns (uint amount) {
        amount = erc20.allowance(msg.sender, address(this));
        require(erc20.transferFrom(msg.sender, address(this), amount));
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
    constructor(address registryAddress, address _v2OracleAddress, address _priceFeedAddress)
        public
        ContractCreator(registryAddress, _v2OracleAddress, _priceFeedAddress) {} // solhint-disable-line no-empty-blocks

    function createTokenizedDerivative(
        address sponsor,
        address admin,
        uint defaultPenalty,
        uint requiredMargin,
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
            sponsor,
            admin,
            v2OracleAddress,
            priceFeedAddress,
            defaultPenalty,
            requiredMargin,
            product,
            fixedYearlyFee,
            disputeDeposit,
            returnCalculator,
            startingTokenPrice,
            expiry
        );

        _registerContract(sponsor, address(derivative));

        return address(derivative);
    }
}
