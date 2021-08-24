#!/usr/bin/env bash

## This script is a comprehensive guide for testing the voter dapp.
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 🐉 Starting Voter dApp tests 🐉                                  #'
echo '#                                                                  #'
echo -e '####################################################################\n'

## Tells script to exit as soon as any line in the script fails: https://www.peterbe.com/plog/set-ex
set -e

echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 0/13. Prerequisites                                              #'
echo '#                                                                  #'
echo -e '####################################################################\n'
## Will need to run some JS scripts from packages/core

# Prompt user to start Ganache in another window
echo "- Have you started Ganache in a separate window at port 9545? Be sure to use the following mnemonic: \"candy maple cake sugar pudding cream honey rich smooth crumble sweet treat\" "
select yn in "Yes" "Help" "Exit"; do
    case $yn in
        Yes ) break;;
        Help ) echo "🚸 Run 'ganache-cli -p 9545 -e 10000000000 -l 9000000 -m \"candy maple cake sugar pudding cream honey rich smooth crumble sweet treat\"' in a separate window before starting this script";;
        Exit ) exit;;
    esac
done


# Set up blockchain env to render against.
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 1/13. Deploying voting contracts on test network                 #'
echo '#                                                                  #'
echo -e '####################################################################\n'

# This hacky snippet just copies the newer voting bytecode into the package artifacts that the voter dapp uses.
# This forces the voter dapp to deploy the _new_ voting contract with all the other contracts unchanged, which will
# force it to test the old 2key contract with the new voting contract.
yarn truffle compile
yarn run truffle migrate --reset --network test
echo "- ✅ Migration complete!"

# Submit 4 normal price requests:
# - 1 to commit & reveal on browser 8 decimals
# - 1 to commit & reveal on browser 6 decimals
# - 1 to commit & reveal on browser 8 decimals and ancillary data
# - 1 to commit & reveal on browser 6 decimals and ancillary data
# Submit 1 admin price request:
# - 1 to commit & reveal on browser
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 2/13. Submitting price requests                                  #'
echo '#                                                                  #'
echo -e '####################################################################\n'
yarn run truffle exec ../core/scripts/local/RequestOraclePrice.js --network test --identifier TEST8DECIMALS --time 1570000000
yarn run truffle exec ../core/scripts/local/RequestOraclePrice.js --network test --identifier TEST6DECIMALS --time 1570000000 
yarn run truffle exec ../core/scripts/local/RequestOraclePrice.js --network test --identifier TEST8DECIMALSANCIL --time 1570000000 --ancillaryData='8dec'
yarn run truffle exec ../core/scripts/local/RequestOraclePrice.js --network test --identifier TEST6DECIMALSANCIL --time 1570000000 --ancillaryData='6dec'
yarn run truffle exec ../core/scripts/mainnet/ProposeAdmin.js --network test --prod
echo "- ✅ Price requests submitted!"

# Advance to next commit phase
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 3/13. Advancing to start of next voting round                    #'
echo '#                                                                  #'
echo -e '####################################################################\n'
yarn run truffle exec ../core/scripts/local/AdvanceToCommitPhase.js --network test
echo "- ✅ Advanced to next commit phase!"

# Prompt user to import account[0] from Ganache into Metamask
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 4/13. Setting up Metamask                                        #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- ‼️ Before testing the voter dApp, you will need to import the account holding voter tokens into your Metamask browser extension. Type \"Help\" to see account details and \"Continue\" when you are ready"
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Import the following Private Key into Metamask: https://metamask.zendesk.com/hc/en-us/articles/360015489331-Importing-an-Account" && yarn truffle exec ../core/scripts/local/getPrivateKeyFromMnemonic.js --mnemonic "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat" --network test;;
        Exit ) exit;;
    esac
done

# Prompt user to start voter dApp
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 5/13. Starting Voter dApp                                        #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Start the voter dApp by switching to the packages/voter-dapp directory (cd ../voter-dapp) and starting the server on port 3000 by running \"yarn start\" from a different window, point the network to your local Ganache at port 9545, and then enter 1 to continue: "
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 The contracts can be tested via Metamask by running \"yarn start\" from the packages/voter-dapp directory";;
        Exit ) exit;;
    esac
done

# Prompt user to vote without the 2 key wallet
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 6/13. Committing                                                 #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Commit votes. Click Edit to enter a vote, and then Save to submit a transaction via Metamask. You can enter any price for the non-admin price request, and check that the admin Commit button displays a radio selection of YES and NO. Prior to committing a vote, the Current Vote column should only display an Edit button. After committing, your vote should be displayed (and translated into YES or NO for Admin votes). Finally, after committing click the DISPLAY button to make sure that the price was committed using the correct precision."
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Navigate to localhost:3000 in a browser and connect to the dApp with the correct account on Metamask. Click Edit to enter a vote, and then Save to submit a transaction via Metamask. You should see 3 price requests available to commit prices for. Commit votes for the following identifiers: [USDETH-Commit+Reveal, Admin-0]. Finally, hit Continue";;
        Exit ) exit;;
    esac
done
echo "- Advancing to the Reveal phase of the current voting round"
yarn run truffle exec ../core/scripts/local/AdvanceToNextVotingPhase.js --network test

# Snapshot the current round
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 7/13. Snapshotting voting token balances                         #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Before reveals can take place, a snapshot of current voting token balances must be taken"
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Click and sign to generate snapshot for current round.";;
        Exit ) exit;;
    esac
done

# Prompt user to reveal votes
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 8/13. Revealing                                                  #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Reveal votes. Click Edit to select the commits to reveal, and then Save to submit a transaction via Metamask. Prior to and after revealing, your committed values should be displayed (and translated into YES or NO for Admin votes). After revealing successfully, the Status column should display Revealed"
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Click Edit to select commits to reveal, and then Save to submit a transaction via Metamask. You should see 2 price requests available to reveal prices for. Reveal votes for the following identifiers: [USDETH-Commit+Reveal, Admin-0]. Finally, hit Continue after you see Revealed in the Status column";;
        Exit ) exit;;
    esac
done
echo "- Advancing to the next Voting round"
yarn run truffle exec ../core/scripts/local/AdvanceToNextVotingPhase.js --network test

# Claim rewards
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 9/13. Claiming rewards                                           #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Claim rewards by clicking Claim Your Rewards under Retrieve Voting Rewards. You should receive your previous round's token balance (100,000,000) multiplied by the inflation rate (0.05%) multiplied by 2 for the two price requests (e,g, you should have received 100,000 tokens total). Note that you are the one and only voter so you should always have voted with the majority."
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Click Claim Your Rewards under Retrieve Voting Rewards and submit the transaction via Metamask. You should receive 100,000 new tokens. Finally, hit Continue after you see your balance has successfully increased";;
        Exit ) exit;;
    esac
done

# Prompt user to verify Resolved Requests
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 10/13. Resolved Requests                                         #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Hit the Resolved Requests button and verify that your submitted votes are displayed properly. Hit continue once you've confirmed this"
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Click Resolved Requests button and you should see the Your Vote and Correct Vote columns filled with your vote";;
        Exit ) exit;;
    esac
done

echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 11/13. 2 Key Wallet Test                                         #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- If you've already tested voting with the 2 Key Wallet then hit Exit and complete the tests. Otherwise hit Continue to see instructions for deploying the 2 Key contract."
select yn in "Continue" "Exit"; do
    case $yn in
        Continue ) break;;
        Exit ) exit;;
    esac
done

# Setting up the 2 key wallet
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 12/13. Create a voting proxy contract                            #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Follow this tutorial to set up your 2Key wallet via the voter dApp: https://docs.umaproject.org/uma-tokenholders/voting-2key. Use your current address as the Cold Wallet Address and transfer your tokens to the proxy contract. You will be prompted to connect again to the voter dApp, but if this doesn't happen automatically then you can simply refresh the page. The Resolved Requests will no longer show that you voted on the two resolved price requests because your voting account has changed to the proxy contract's address"
select yn in "Continue" "Help" "Exit"; do
    case $yn in
        Continue ) break;;
        Help ) echo "🚸 Create and Transfer tokens to a new 2 Key contract. Hit continue once your voting tokens are loaded into the 2Key wallet. Connect your account again to the dApp and enter Continue. The Resolved Requests will no longer show that you voted on the two resolved price requests because your voting account has changed to the proxy contract's address";;
        Exit ) exit;;
    esac
done

# Prompt user to vote with the 2 key wallet
echo -e '\n####################################################################'
echo '#                                                                  #'
echo '# 13/13. Testing with the 2 Key wallet                             #'
echo '#                                                                  #'
echo -e '####################################################################\n'
echo "- Restart this test script and this time use the 2 Key Wallet to vote. You should restart ganache-cli to make a clean testing environment."
echo "🕺🏾💃🏻 Test complete!"
