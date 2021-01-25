/**
 * Return voting contract, voting account, and signing account based on whether user is using a
 * designated voting proxy.
 * @param {String} account current default signing account
 * @param {Object} voting DVM contract
 * @param {Object} [designatedVoting] designated voting proxy contract
 * @return votingContract Contract to send votes to.
 * @return votingAccount address that votes are attributed to.
 * @return signingAddress address used to sign encrypted messages.
 */
export function getVotingRoles(account: string, voting: any, designatedVoting?: any): {
    votingContract: any;
    votingAccount: any;
    signingAddress: string;
};
export function getLatestEvent(eventName: any, request: any, roundId: any, account: any, votingContract: any): Promise<any>;
/**
 * Generate a salt and use it to encrypt a committed vote in response to a price request
 * Return committed vote details to the voter.
 * @param {Object} request {identifier, time}
 * @param {String} roundId
 * @param {Object} web3
 * @param {String | Number | BN} price
 * @param {String} signingAccount
 * @param {String} votingAccount
 * @param {String?} decimals Default 18 decimal precision for price
 */
export function constructCommitment(request: any, roundId: string, web3: any, price: string | number | any, signingAccount: string, votingAccount: string, decimals?: string | null): Promise<{
    identifier: any;
    time: any;
    hash: any;
    encryptedVote: string;
    price: string;
    salt: any;
}>;
/**
 * Decrypt an encrypted vote commit for the voter and return vote details
 * @param {Object} request {identifier, time}
 * @param {String} roundId
 * @param {Object} web3
 * @param {String} signingAccount
 * @param {Object} votingContract deployed Voting.sol instance
 * @param {String} votingAccount
 */
export function constructReveal(request: any, roundId: string, web3: any, signingAccount: string, votingContract: any, votingAccount: string): Promise<{
    identifier: any;
    time: any;
    price: any;
    salt: any;
}>;
export function batchCommitVotes(newCommitments: any, votingContract: any, account: any): Promise<{
    successes: any[];
    batches: number;
}>;
export function batchRevealVotes(newReveals: any, votingContract: any, account: any): Promise<{
    successes: any[];
    batches: number;
}>;
export function batchRetrieveRewards(requests: any, roundId: any, votingContract: any, votingAccount: any, signingAccount: any): Promise<{
    successes: any[];
    batches: number;
}>;
