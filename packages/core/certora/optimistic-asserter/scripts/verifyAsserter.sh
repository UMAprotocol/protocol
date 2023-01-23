certoraRun ./certora/optimistic-asserter/harness/OptimisticAsserter.sol:OptimisticAsserterHarness \
            ./certora/optimistic-asserter/harness/MockEscalationManager.sol \
            ./certora/optimistic-asserter/harness/MockStore.sol:Store \
           ./contracts/data-verification-mechanism/implementation/Finder.sol \
           ./contracts/data-verification-mechanism/implementation/IdentifierWhitelist.sol \
           ./contracts/common/implementation/AddressWhitelist.sol \
           ./contracts/common/implementation/TestnetERC20.sol \
           ./contracts/common/test/BasicERC20.sol \
\
\
--verify OptimisticAsserterHarness:certora/optimistic-asserter/specs/Asserter_Bonds.spec \
\
\
--link OptimisticAsserterHarness:finder=Finder \
\
\
--packages @openzeppelin=../../node_modules/@openzeppelin \
--path . \
--solc solc8.16 \
--send_only \
--settings -mediumTimeout=200,-byteMapHashingPrecision=10 \
--loop_iter 2 \
--optimistic_loop \
--msg "UMA Asserter Bonds " 
# ./contracts/data-verification-mechanism/implementation/Store.sol \