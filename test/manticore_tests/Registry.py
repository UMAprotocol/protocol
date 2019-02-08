"""
Manticore tests for the Registry.
"""
import sys

from manticore.ethereum import Detector, ManticoreEVM

MAX_MANTICORE_DEPTH = 2

# TODO(ptare): Extract this out.
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

# Create accounts used in this test.
owner_account = m.create_account(balance=1000)
derivative_creator = m.create_account(balance=1000)

# Import remapping.
import_remapping = [
    'openzeppelin-solidity/=/home/ethsec/protocol/node_modules/openzeppelin-solidity/',
    '/tmp/=/home/ethsec/protocol/contracts/',
]

# Manticore doesn't appear to allow calling methods and getting their values. Instead, we use this hack of creating a
# second contract that calls the desired method and saves the result in a variable.
interacter_storage_slot = 0
interacter_code = '''
pragma solidity ^0.5.0;

import "./Registry.sol";

// Only used to interact with the Registry.
// TODO(ptare): Figure out the right way to pass constructor variables.
contract Interactor {
    bool public wasRegistered;

    function isRegistered(address registryAddress, address derivativeAddress) external {
      Registry registry = Registry(registryAddress);
      wasRegistered = registry.isDerivativeRegistered(derivativeAddress);
    }
}
'''
interactor_account = m.solidity_create_contract(
        interacter_code, owner=owner_account,
        # For some reason, Manticore requires specifying the contract name even if there's only one contract in the
        # file, even though the documentation claims otherwise.
        contract_name='Interactor',
        solc_remaps=import_remapping);

# Create the Registry contract.
with open('contracts/Registry.sol', 'r') as contract_file:
    source_code = contract_file.readlines()

contract_account = m.solidity_create_contract(
        ''.join(source_code), owner=owner_account,
        contract_name='Registry',
        solc_remaps=import_remapping)

# TODO(ptare): Unify these annoyingly similar functions.
def isRegisteredInAllStates(derivativeToCheck):
    interactor_account.isRegistered(contract_account, derivativeToCheck)
    for state in m.running_states:
        isDerivativeRegistered = state.platform.get_storage_data(
                interactor_account.address, interacter_storage_slot)
        if state.can_be_true(isDerivativeRegistered == 0):
            return False
    else:
        return True

def isRegisteredInAnyState(derivativeToCheck):
    interactor_account.isRegistered(contract_account, derivativeToCheck)
    for state in m.running_states:
        isDerivativeRegistered = state.platform.get_storage_data(
                interactor_account.address, interacter_storage_slot)
        if state.can_be_true(isDerivativeRegistered == 1):
            return True
    else:
        return False

# Register a derivative.
derivativeToRegister = 125
contract_account.addDerivativeCreator(derivative_creator.address)
contract_account.registerDerivative([10], derivativeToRegister, caller=derivative_creator)
if not isRegisteredInAllStates(derivativeToRegister):
    print('Derivative was not registered in some states, something is wrong')
    m.finalize()
    sys.exit(1)

# Unregister that derivative.
contract_account.unregisterDerivative(derivativeToRegister, caller=derivative_creator)
if isRegisteredInAnyState(derivativeToRegister):
    print('Derivative remained registered in some states, something is wrong')
    m.finalize()
    sys.exit(1)

# Now register a new derivative symbolically. We want to maintain the invariant that derivativeToRegister can't ever get
# re-registered.
# The make_symbolic_address function does *not* do what we want, because it only uses known addresses. Instead, we use
# make_symbolic_value directly to make a 160 bit integer.
derivativeAddress = m.make_symbolic_value(nbits=160, name='symbolicDerivativeAddress')
# The following command never exits :(, so we can't actually write this test. But if we could, the assertion would be
# that isRegisteredInAnyState(derivativeToRegister) is still False.
# contract_account.registerDerivative([10], derivativeAddress, caller=derivative_creator)

print('Tests passed')
