/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity ^0.4.22;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";


// This interface allows us to get the Ethereum-USD exchange rate
contract VoteCoinInterface {
    string public ETHUSD;
}


contract Derivative {
    // Financial information
    mapping(address => int256) public balances; // Stored in Wei
    int256 public defaultPenalty;  //
    int256 public requiredMargin;  //

    // Contract states
    address ownerAddress;          // should this be public?
    address counterpartyAddress;   //
    bool public defaulted = false;
    bool public terminated = false;
    uint public startTime;
    uint public endTime;

    VoteCoinInterface oracle;
    address oracleAddress;
    int256 npv;  // Net present value is measured in Wei

    constructor(
        address _counterpartyAddress,
        address _oracleAddress,
        uint _startTime,
        uint _endTime,
        int256 _defaultPenalty,
        int256 _requiredMargin
    ) public {

        // Contract states
        startTime = _startTime;
        endTime = _endTime;
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        npv = 0;

        // Address information
        ownerAddress = msg.sender;
        oracleAddress = _oracleAddress;
        counterpartyAddress = _counterpartyAddress;
        balances[ownerAddress] = 0;
        balances[counterpartyAddress] = 0;
    }

    function updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable
        int256 npvDiff = npv - npvNew;
        npv = npvNew;

        balances[ownerAddress] += npvDiff;
        balances[counterpartyAddress] -= npvDiff;
    }

    function isDefault(address party) constant public returns (bool) {
        return balances[party] < requiredMargin;
    }

    function whoDefaults()
        constant
        public
        returns (bool inDefault, address defaulter, address notDefaulter)
    {
        inDefault = false;

        if (isDefault(ownerAddress)) {
            defaulter = ownerAddress;
            notDefaulter = counterpartyAddress;
            inDefault = true;
        }
        else if (isDefault(counterpartyAddress)) {
            defaulter = counterpartyAddress;
            notDefaulter = ownerAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    function isTerminated(uint time) constant public returns (bool ttt){
        ttt = terminated || time > endTime;
    }

    // Concrete contracts should inherit from this contract and then should only
    // need to implement a `compute_npv` function. This allows for generic
    // choices of npv functions
    function computeNpv() public returns (int256 value);

    function remargin() external {
        // Check if time is over...
        // TODO: Ensure that the contract is remargined at the time that the
        // contract ends
        uint currentTime = now;
        if (currentTime > endTime) {
            terminated = true;
        }

        // Update npv of contract
        int256 npvNew = computeNpv();
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
            defaulted = true;
            terminated = true;
        }
    }

    function deposit() payable public returns (bool success) {
        balances[msg.sender] += int256(msg.value);
        return true;
    }

    function withdraw(uint256 amount) payable public returns (bool success) {
        // If the contract has been defaulted on or terminated then can withdraw
        // up to full balance -- If not then they are required to leave at least
        // `required_margin` in the account
        int256 withdrawableAmount = (defaulted || terminated) ?
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

}


contract Derivative_ConstantNPV is Derivative, usingOraclize {


    function computeNpv() public returns (int256 value) {
        oracle = VoteCoinInterface(oracleAddress);
        string memory p = oracle.ETHUSD();
        int256 price = int256(parseInt(p, 2));

        return price;
    }
}
