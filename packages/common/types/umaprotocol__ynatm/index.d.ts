declare module "@umaprotocol/ynatm" {
    export const EXPONENTIAL: (base?: number, inGwei?: boolean) => (arg: { x?: number }) => number;
    export const LINEAR: (slope?: number, inGwei?: boolean) => (arg: { x?: number, c?: number }) => number;
    export const DOUBLES: (arg: { y?: number }) => number;
    export const toGwei: (x: number) => number;

    export interface SendArgs<T> {
        sendTransactionFunction: (gasPrice: number) => T;
        minGasPrice: string | number;
        maxGasPrice: string | number;
        gasPriceScalingFunction?: (args: { x?: number, y?: number, c?: number }) => number;
        delay?: number;
        rejectImmediatelyOnCondition?: (e: Error) => boolean;
    }

    export const send: <T>(args: SendArgs<T>) => T;
}