
declare module "node-metamask" {

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

    class RemoteMetaMaskProvider {
        constructor(metamaskConnector: MetamaskConnector);
        sendAsync(payload: JsonRpcPayload, callback: (error: Error | null, result?: JsonRpcResponse) => void): void;
        send(payload: JsonRpcPayload, callback: (error: Error | null, result?: JsonRpcResponse) => void): void;
    }

    export default class MetamaskConnector {
        constructor(options: any);
        start(): Promise<void>;
        stop(): Promise<boolean>;
        ready(): boolean;
        send(action: any, requestId: any, payload: any, requiredAction: any): Promise<{ requestId: any, result: any }>;
        getProvider(): RemoteMetaMaskProvider;
        static handleAction(action: any, requestId: any, payload: any): { responseAction: any; responseRequestId: any, responsePayload: any };
        static handleMessage(msg: string): ReturnType<MetaMaskConnector["handleAction"]>;
    };

}
