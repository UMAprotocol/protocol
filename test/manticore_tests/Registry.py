"""
A sample manticore run to find a storage overwrite problem.
"""
import sys

from manticore.ethereum import Detector, ManticoreEVM

MAX_MANTICORE_DEPTH = 2

class StopAtDepth(Detector):
    ''' This just aborts explorations that are too deep '''

    def will_start_run_callback(self, *args):
        with self.manticore.locked_context('seen_rep', dict) as reps:
            reps.clear()

    def will_decode_instruction_callback(self, state, pc):
        world = state.platform
        with self.manticore.locked_context('seen_rep', dict) as reps:
            item = (world.current_transaction.sort == 'CREATE', world.current_transaction.address, pc)
            if not item in reps:
                reps[item] = 0
            reps[item] += 1
            if reps[item] > MAX_MANTICORE_DEPTH:
                state.abandon()


# Initialize Manticore.
m = ManticoreEVM()
m.verbosity(3)

# We need to stop Manticore's search depth at 2, otherwise it loops forever.
m.register_plugin(StopAtDepth())


with open('contracts/Registry.sol', 'r') as contract_file:
    source_code = contract_file.readlines()

owner_account = m.create_account(balance=1000)
derivative_creator = m.create_account(balance=1000)

interacter_code = '''
pragma solidity ^0.5.0;

import "./Registry.sol";

contract Interactor {
    bool public wasRegistered;

    function isRegistered(address registryAddress, address derivativeAddress) external {
      Registry registry = Registry(registryAddress);
      wasRegistered = registry.isDerivativeRegistered(derivativeAddress);
    }
}
'''
interactor_account = m.solidity_create_contract(interacter_code, owner=owner_account,
  contract_name="Interactor",
  solc_remaps=["openzeppelin-solidity/=/home/ethsec/protocol/node_modules/openzeppelin-solidity/",
  "/tmp/=/home/ethsec/protocol/contracts/"]);

# Create the contract.
contract_account = m.solidity_create_contract(''.join(source_code), owner=owner_account,
  contract_name="Registry",
  solc_remaps=["openzeppelin-solidity/=/home/ethsec/protocol/node_modules/openzeppelin-solidity/",
  "/tmp/=/home/ethsec/protocol/contracts/"])

contract_account.addDerivativeCreator(derivative_creator.address)

derivativeAddress = m.make_symbolic_value(nbits=160, name='haha')
m.constrain(derivativeAddress > 0)
m.constrain(derivativeAddress < 10)
# derivativeAddress = m.make_symbolic_address(name='derivativeAddress')
contract_account.registerDerivative([10], derivativeAddress, caller=derivative_creator)
# interactor_account.isRegistered(contract_account, derivativeAddress)
print("DONT CALLING")

m.finalize()

# interactor_account.isRegistered(contract_account, 2)
# for state in m.running_states:
#     storage_slot = 0
#     der = state.platform.get_storage_data(interactor_account.address, storage_slot)
#     print("DER", state.must_be_true(der == 0))
# 
# contract_account.registerDerivative([], 2, caller=derivative_creator)
# 
# interactor_account.isRegistered(contract_account, 2)
# interactor_account.isRegistered(contract_account, 2)
# for state in m.running_states:
#     storage_slot = 0
#     der = state.platform.get_storage_data(interactor_account.address, storage_slot)
#     print("DER AGAIN", state.must_be_true(der == 1))
# 
# contract_account.unregisterDerivative(2, caller=derivative_creator)
# 
# 
# interactor_account.isRegistered(contract_account, 2)
# for state in m.running_states:
#     storage_slot = 0
#     der = state.platform.get_storage_data(interactor_account.address, storage_slot)
#     print("DER after unregistering", state.must_be_true(der == 0))
# 
# derivativeAddress = m.make_symbolic_value(nbits=160, name='haha')
# # derivativeAddress = m.make_symbolic_address(name='derivativeAddress')
# # contract_account.registerDerivative([], derivativeAddress, caller=derivative_creator)
# contract_account.registerDerivative([], 5, caller=derivative_creator)
# print("DONT CALLING")
# 
# m.finalize()
# interactor_account.isRegistered(contract_account, 2)
# for state in m.running_states:
#     storage_slot = 0
#     der = state.platform.get_storage_data(interactor_account.address, storage_slot)
#     print("DER after reregistering", state.must_be_true(der == 0))

# contract_account.registerDerivative([15, 16], 3)
# blah2 = contract_account.isDerivativeRegistered(3)
# print("BLAH:", blah, "BLAH2", blah2)

# Set a symbolic key.
# key = m.make_symbolic_value(name='key')
# contract_account.setMetadata(key, 1)
# 
# # Check all the running states if `shouldAlwaysBeFalse`, in storage slot 1, could ever be true.
# found_violation = False
# for state in m.all_states:
#     flag_storage_slot = 1
#     flag_value = state.platform.get_storage_data(contract_account.address, flag_storage_slot)
#     if state.can_be_true(flag_value != 0):
#         state.constrain(flag_value != 0)
#         print("Dumping test case to:", m.workspace)
#         m.generate_testcase(state, 'Storage overwritten', flag_value != 0, name='found')
#         print("Key: ", state.solve_one(key, constrain=True))
#         found_violation = True
# 
# if found_violation:
#     sys.exit(1)
