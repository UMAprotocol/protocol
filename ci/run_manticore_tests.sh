# Invoke this shell script (from your protocol directory) via:
# docker run -v `pwd`:/home/ethsec/protocol -w /home/ethsec/protocol trailofbits/eth-security-toolbox ci/run_manticore_tests.sh
python3.6 test/manticore_tests/MetaCoin.py
