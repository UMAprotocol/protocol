declare module "@umaprotocol/truffle-ledger-provider" {
    interface JsonRpcPayload {
        jsonrpc: string;
        method: string;
        params: any[];
        id?: string | number;
    }
    
    interface JsonRpcResponse {
        jsonrpc: string;
        id: number;
        result?: any;
        error?: string;
    }

    export default class TruffleLedgerProvider {
        constructor(options: any, urlOrProvider: any);
        sendAsync(payload: JsonRpcPayload, callback: (error: Error | null, result?: JsonRpcResponse) => void): void;
        send(payload: JsonRpcPayload, callback: (error: Error | null, result?: JsonRpcResponse) => void): void;
    }
}