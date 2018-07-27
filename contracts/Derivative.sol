pragma solidity ^0.4.22;

import "github.com/oraclize/ethereum-api/oraclizeAPI.sol";


// This interface allows us to get the Ethereum-USD exchange rate
contract OracleInterface {
    string public ETHUSD;
}


contract Derivative {
    // Financial information
    mapping(address => int256) public balances; // Stored in Wei
    int256 public default_penalty;  //
    int256 public required_margin;  //

    // Contract states
    address owner_address;          // should this be public?
    address counterparty_address;   //
    bool public defaulted = false;
    bool public terminated = false;
    uint public start_time;
    uint public end_time;

    int256 npv;  // Net present value is measured in Wei

    function Constructor(
        address _counterparty_address,
        uint _start_time,
        uint _end_time,
        int256 _default_penalty,
        int256 _required_margin
    ) public {

        // Contract states
        start_time = _start_time;
        end_time = _end_time;
        default_penalty = _default_penalty;
        required_margin = _required_margin;
        npv = 0;

        // Address information
        owner_address = msg.sender;
        counterparty_address = _counterparty_address;
        balances[owner_address] = 0;
        balances[counterparty_address] = 0;
    }

    function update_balances(int256 npv_new) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable
        int256 npv_diff = npv - npv_new;
        npv = npv_new;

        balances[owner_address] += npv_diff;
        balances[counterparty_address] -= npv_diff;
    }

    function is_default(address party_i) constant public returns (bool) {
        return balances[party_i] < required_margin;
    }

    function who_defaults()
        constant
        public
        returns (bool in_default, address defaulter, address not_defaulter)
    {
        in_default = false;

        if (is_default(owner_address)) {
            defaulter = owner_address;
            not_defaulter = counterparty_address;
            in_default = true;
        }
        else if (is_default(counterparty_address)) {
            defaulter = counterparty_address;
            not_defaulter = owner_address;
            in_default = true;
        }

        return (in_default, defaulter, not_defaulter);
    }

    function is_terminated(uint time) constant public returns (bool ttt){
        ttt = terminated || time > end_time;
    }

    // Concrete contracts should inherit from this contract and then should only
    // need to implement a `compute_npv` function. This allows for generic
    // choices of npv functions
    function compute_npv() public returns (int256 value);

    function remargin() external {
        // Check if time is over...
        // TODO: Ensure that the contract is remargined at the time that the
        // contract ends
        uint current_time = now;
        if (current_time > end_time) {
            terminated = true;
        }

        // Update npv of contract
        int256 npv_new = compute_npv();
        update_balances(npv_new);

        // Check for default
        bool in_default;
        address defaulter;
        address not_defaulter;
        (in_default, defaulter, not_defaulter) = who_defaults();

        // Check whether goes into default
        if (in_default) {
            int256 penalty;
            penalty = (balances[defaulter] < default_penalty) ?
                      balances[defaulter] :
                      default_penalty;

            balances[defaulter] -= penalty;
            balances[not_defaulter] += penalty;
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
        int256 withdrawable_amount = (defaulted || terminated) ?
                                     balances[msg.sender] :
                                     balances[msg.sender] - required_margin;

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawable_amount) > int256(amount)),
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



contract Derivative_ConstantNPV is usingOraclize, Derivative {

    OracleInterface oracle;
    address oracleAddress = 0x739De5b0fa95F40664CbdfC5D350e0c43B66f72e;

    function compute_npv() public returns (int256 value) {
        oracle = OracleInterface(oracleAddress);
        string memory p = oracle.ETHUSD();
        int256 price = int256(parseInt(p, 2));

        return price;
    }
}
