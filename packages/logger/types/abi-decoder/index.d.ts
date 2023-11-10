declare module "abi-decoder" {
    export function addABI(abi: any | any[]): void;
    export function decodeMethod(data: string): { name: string; params: any };
    export function getMethodIDs(): { [signature: string]: any };
    export function getABIs(): any[];
    export function decodeLogs(logs: any[]): { name: string; events: any[]; address: string }[];
    export function removeABI(abi: any | any[]): void;
}