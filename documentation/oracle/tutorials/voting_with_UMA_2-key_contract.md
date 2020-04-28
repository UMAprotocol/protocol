# Voting With the UMA 2-Key Contract

The UMA DVM two-key contract enables you to actively engage in voting using hot keys (private keys stored on machine and used often), but protect your funds with the stronger, and preferable, use of cold keys (private keys stored offline and used rarely).

Each two-key contract is a unique smart contract that you deploy. It keeps track of:
* The number of UMA tokens you have deposited into the two-key contract
* The address of your hot wallet; the hot wallet is permissioned to sign transactions and vote in DVM governance
* The address of your cold wallet; the cold wallet (and importantly, not the hot wallet or any other address) is permissioned to withdraw UMA tokens from the two-key contract

## Prerequisities
* You need some ETH in your hot wallet for the initial deployment of the 2-key contract and for submitting all subsequent votes.
* You need some ETH in your cold wallet if you want to withdraw tokens from the 2-key contract.
* If your cold wallet is a Ledger hardware wallet, you need to have enabled Contract Data in the Ledger Ethereum app. 
Otherwise, your Ledger wallet will fail when signing transactions.

## Instructions to deploy and verify your own 2-key contract

### Connect
Navigate to the DVM voter dApp (vote.umaproject.org) and connect your Metamask hot wallet. 
This will be your voting wallet going forward. 

### Deploy
Input your cold wallet address, and click deploy. 
You’ll have to approve the transaction in Metamask and wait for the transaction to finish mining. 
Only your cold wallet will be allowed to withdraw tokens from this smart contract.

### (recommended) Verify
The following steps help you verify that your two-key contract was deployed correctly and check that the permissions are held by the correct address.
* Copy the 2-key smart contract address from the voter dApp and view it on Etherscan (etherscan.io/address/YOUR_TWO_KEY_ADDRESS#readContract)
* Input roleID `0` in function `1. getMember`, and click query. Check that the address output matches your cold wallet address. 
* Input roleID `1` in function `1. getMember`, and click query. Check that the address output matches your hot wallet address. 

Note: if Etherscan returns a JSON error message, wait a few hours and try again. 
This is recommended before transfering UMA tokens into the two-key contract. 

### Transfer
Send UMA tokens to the two-key contract address. 
You can immediately start voting with your hot keys at the voter dApp.

### Withdraw
The following steps let you withdraw UMA tokens from the two-key contract using your cold keys. 
You will have to withdraw and deploy a new two-key contract if you want to designate a new hot key for voting. 
* Navigate to etherscan.io/address/YOUR_TWO_KEY_ADDRESS#writeContract
* Connect your cold wallet by clicking the “Connect to web3” link
* Use function `10. withdrawErc20`
* Input erc20Address: `0x04fa0d235c4abf4bcf4787af4cf447de572ef828`
* Input the number of tokens that you want to withdraw * 10^18 (for example, if you want to withdraw 1.1 tokens, you should input 1100000000000000000)
* Click “Write”
* Confirm the transaction with your cold keys and wait for the transaction to finish mining

## Notes
* Post-deployment, you cannot modify your voting key or ownership key in the 2-key contract. 
If you wish to make changes, you must withdraw your tokens and deploy a new contract. 
* The same hot key cannot be used to vote for multiple two-key contracts.
* The same cold key can be used to withdraw for multiple two-key contracts.
You are responsible for gas on all transactions
