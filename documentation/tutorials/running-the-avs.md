# Automated Voting System setup instructions for Google Cloud

These are instructions to set up the Automated Voting System that UMA has created on a Google Cloud account. If you
like, you can set it up with another cloud service (AWS, Azure); just point your cloud computing instance to the docker
image provided here: docker.io/umaprotocol/voting.

Note: these instructions are meant to be used on testnet with accounts that control no mainnet assets. Future versions
will incorperate a delegation mechanism so your tokens are not at risk when using them with this type of system.
 
## Things you’ll need before you begin

- A google cloud project that has a valid billing account linked to it. Information on how to do this should be
available at https://cloud.google.com/.

- The 12 secret seed words associated with your Ethereum account. If you use Metamask, you should be able to retrieve
these by going to Settings -> Security & Privacy and pressing the “Reveal Seed Words” button. Sadly, if your wallet was
not created using Metamask, we do not currently support it.

- Your account must have enough ETH to run voting transactions - we suggest having at least 1 ETH. If you are planning
on running this on Kovan, you’ll only need Kovan ETH. You can get Kovan ETH by logging into this gitter chat with your
github chat and pasting your address into the chat.

- Your account must have Voting Tokens for your vote to impact the outcome. To get testnet vote tokens, please send an
email to [hello@umaproject.org](mailto:hello@umaproject.org). To check your token balance:

    1. Go [here](https://ethereum.stackexchange.com/a/17101) to find the network id for the network you're using.

    2. Find the file named [YOUR_NETWORK_ID].json in
       [this folder](https://github.com/UMAprotocol/protocol/tree/master/core/networks). If the file doesn't exist,
       there is no UMA deployment on that network.

    3. Find the line in that file that says `"contractName": "VotingToken",`.

    4. The next line should have an address on it - that's the address for the Voting Token.

    5. You can add the Voting token to metamask or find it on Etherscan to check your balance.

- It’s recommended that you get a free Infura API key. Do so by going to https://www.infura.io/, creating an account,
creating a project, and grabbing the project ID (we call this the INFURA_API_KEY) for use later in this tutorial.

- It's reccomended that you get an [Intrinio API key](https://intrinio.com/) with access to their bats equities
historical data and historical Forex data.

## Sign into Google Cloud

Go to [Google Cloud](https://cloud.google.com/). If you are not signed into a google account, click the sign in button
at the top right. Once you are signed in, click the “Console” button in the top right portion of the screen to navigate
to the Google Cloud console.

Make sure you have your desired google cloud project selected. The drop down should be in the top left portion of the
screen to the right of “Google Cloud Platform”.

## Set up email alerting

There are two ways to set up email alerting - by allowing the AVS to email you using your own gmail account or by using
SendGrid to send to you from an arbitrary spoofed address (this might show up as spam in your inbox). To use gmail, you
must have 2 factor authentication enabled on your gmail account. We recommend gmail, but feel free to use either.

### Gmail email alerting

1. Go to https://myaccount.google.com/apppasswords.

2. Log in to your gmail account if necessary.

3. Select “Mail” from the first dropdown and “Other” from the second dropdown. Type `AVS` into the text field that
appears.

4. Copy the 16 characters that appear, they are your app password - you will need to provide them later.

5. Go back to [Google Cloud](https://cloud.google.com/) when you’re done.


### SendGrid

1. Search “SendGrid” in the Google Cloud search bar.

2. Select “SendGrid Email API” in the dropdown.

3. If you are not already signed up, sign up for the free plan (you may need to activate billing for SendGrid in the
process).

4. Once you’re signed up for the free plan, click the “Manage API keys on SendGrid website” button. This should
redirect you to your dashboard on the SendGrid website.

5. Click the “Create API Key” button.

6. Name the API key something like `AVS testing-[firstname]` and select its level of access.

7. You can either give the API key Full Access or give it custom access where at least “Mail Send” is enabled.

8. When finished, click “Create & View”.

9. Copy the API key shown on screen somewhere safe and be ready to paste it later in this guide.

10. Click “Done”.

11. Feel free to close the tab and return to your google cloud tab or just go to
[Google Cloud](https://cloud.google.com/) in your current tab.

## Create your AVS Node

In this section, we're going to create an instance template and then use that template to create an AVS node that will
vote on our behalf.

1. Search “Compute” in the search bar. Click “Compute Engine” in the dropdown.

2. Click “Instance Templates” in the left panel.

3. Click the “Create Instance Template” button.

4. Name your template something memorable, like `voting-[firstname]`.

5. Pick your machine configuration. We recommend n1-standard-1, but feel free to try with a smaller instance to save on
costs - we haven’t tested with them, so they may not have enough memory to run the voting image.

6. Under the “Container” section, check the “Deploy a container image to this VM instance.” box. A new set of options
should appear below that box.

7. Paste the following into the “Container Image” text box: `docker.io/umaprotocol/voting`

8. Click “Advanced container options”.

9. Determine which testnet you want to run the AVS on.

10. Under “Environment Variables”, click “Add variable” for each of the values in the table below that you decide to
add:

| Name                      | Value                                                                                                                  | Notes                                                                                                         | Example                                                                                                  |
|---------------------------|------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| GMAIL_USERNAME            | YOUR_GMAIL_EMAIL_ADDRESS                                                                                               | Only required if you are using Gmail for notifications                                                        | example.sender@gmail.com                                                                                 |
| GMAIL_API_PW              | YOUR_GMAIL_API_PASSWORD                                                                                                | Only required if you are using Gmail for notifications                                                        | abcdefghijklmno                                                                                          |
| SENDGRID_API_KEY          | YOUR_SENDGRID_API_KEY                                                                                                  | Only required if you are using sendgrid for notifications                                                     | qc.SjI0yKoyi3SxZdwX26Q7lY.eSRlSKxnLO4H7b1-FaNbpkDomqlHQHoBgZr2WPKibKe                                    |
| NOTIFICATION_FROM_ADDRESS | YOUR_FROM_EMAIL_ADDRESS                                                                                                | Only required if you are using sendgrid for notifications                                                     | example.sender@gmail.com                                                                                 |
| NOTIFICATION_TO_ADDRESS   | YOUR_NOTIFICATION_EMAIL                                                                                                | Yes, this is the email the notifications will be sent to                                                      | example.receiver@gmail.com                                                                               |
| INFURA_API_KEY            | YOUR_INFURA_API_KEY                                                                                                    | Required                                                                                                      | 00fybcpzlsgvr26s7r0iwtsz2v5t980v                                                                         |
| INTRINIO_API_KEY          | YOUR_INTRINIO_API_KEY                                                                                                  | Required                                                                                                      | DybfijsqeLZEA2ZeSoeaei1uuAGEtW3kdci1vZPoj0Pn                                                             |
| COMMAND                   | eval while true; do $(npm bin)/truffle exec ./scripts/Voting.js --network=[YOUR_NETWORK_NAME]_mnemonic; sleep 60; done | Required, make sure you replace [YOUR_NETWORK_NAME] with a supported testnet name, like `kovan` or `rinkeby`. | eval while true; do $(npm bin)/truffle exec ./scripts/Voting.js --network=kovan_mnemonic; sleep 60; done |

11. Scroll to the bottom of the page and click “Create”.

12. Once your newly created instance template appears on the screen (without a loading icon) under the name you
selected, click it.

13. Click the “Create VM” button at the top of the screen to create your AVS instance. It will vote on your behalf and
send you informational emails when it takes actions.

13. Scroll to the bottom of the page and click “Create”.

You can now confirm that the AVS is working by seeing if it votes correctly for you in the next testnet heartbeat vote request. 
