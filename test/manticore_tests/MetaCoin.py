"""
A sample manticore run to find a storage overwrite problem.
"""
import sys

from manticore.ethereum import Detector, ManticoreEVM

MAX_MANTICORE_DEPTH = 2

class StopAtDepth(Detector):
    '''This just aborts explorations that are too deep.'''

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
m.verbosity(2)

# We need to stop Manticore's search depth at 2, otherwise it loops forever.
m.register_plugin(StopAtDepth())

# Create the contract.
owner_account = m.create_account(balance=1000)
with open('contracts/MetaCoin.sol', 'r') as contract_file:
    source_code = contract_file.readlines()
contract_account = m.solidity_create_contract(''.join(source_code), owner=owner_account)

# Set a symbolic key.
key = m.make_symbolic_value(name='key')
contract_account.setMetadata(key, 1)

# Check all the running states if `shouldAlwaysBeFalse`, in storage slot 1, could ever be true.
found_violation = False
for state in m.all_states:
    # There doesn't seem to be a good way to get the value via a Solidity getter.
    flag_storage_slot = 1
    flag_value = state.platform.get_storage_data(contract_account.address, flag_storage_slot)
    if state.can_be_true(flag_value != 0):
        state.constrain(flag_value != 0)
        print("Dumping test case to:", m.workspace)
        m.generate_testcase(state, 'Storage overwritten', flag_value != 0, name='found')
        print("Key: ", state.solve_one(key, constrain=True))
        found_violation = True

if found_violation:
    print("Found a case where storage got overwritten")
    sys.exit(1)
else:
    print("Test passed")
