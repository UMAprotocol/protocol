export function didContractThrow(promise: any): Promise<any>;
export function mineTransactionsAtTime(web3: any, transactions: any, time: any, sender: any): Promise<any[]>;
export function advanceBlockAndSetTime(web3: any, time: any): Promise<any>;
export function takeSnapshot(web3: any): Promise<any>;
export function revertToSnapshot(web3: any, id: any): Promise<any>;
export function stopMining(web3: any): Promise<any>;
export function startMining(web3: any): Promise<any>;
