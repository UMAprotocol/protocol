const abiDecoder = require("../../../common/AbiUtils.js").getAbiDecoder();

async function decodeGovernorProposal(artifacts, id) {
    const Governor = artifacts.require("Governor");
    const governor = await Governor.deployed();
    const proposal = await governor.getProposal(id);

    console.group();
    console.log("Retrieved Admin Proposal for ID: ", id);
    console.log("Proposal has ", proposal.transactions.length, " transactions");
    for (let i = 0; i < proposal.transactions.length; i++) {
        console.group()
        console.log("Transaction ", i)

        const transaction = proposal.transactions[i];

        // Give to and value.
        console.log("To: ", transaction.to);
        console.log("Value (in Wei): ", transaction.value);

        if (!transaction.data || transaction.data.length === 0 || transaction.data === "0x") {
            // No data -> simple ETH send.
            console.log("Transaction is a simple ETH send (no data).");
        } else {
            // Txn data isn't empty -- attempt to decode.
            const decodedTxn = abiDecoder.decodeMethod(transaction.data);
            if (!decodedTxn) {
                // Cannot decode txn, just give the user the raw data.
                console.log("Cannot decode transaction (does not match any UMA Protocol Signauture.");
                console.log("Raw transaction data: ", transaction.data);
            } else {
                // Decode was successful -- pretty print the results.
                console.log("Transaction details:")
                console.log(JSON.stringify(decodedTxn, null, 4));
            }
        }
        console.groupEnd();
    }
    console.groupEnd();
}

module.exports = { decodeGovernorProposal };
