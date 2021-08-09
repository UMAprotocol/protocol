export interface Parameter {
  name: string;
  type: string;
  components: Parameter[];
}

export type FunctionType = "function" | "constructor" | "receive" | "fallback";
export type StateMutability = "pure" | "view" | "nonpayable" | "payable";

export interface ConstructorFunctionAbi {
  type: "constructor";
  inputs: Parameter[];
  stateMutability: StateMutability;
}

export interface FallbackFunctionAbi {
  type: "fallback";
  stateMutability: StateMutability;
}

export interface FunctionFunctionAbi {
  type: "function";
  name: string;
  inputs: Parameter[];
  outputs: Parameter[];
  stateMutability: StateMutability;
}

export interface ReceiveFunctionAbi {
  type: "receive";
  name: string;
  inputs: Parameter[];
  outputs: Parameter[];
  stateMutability: StateMutability;
}

export type FunctionAbi = ConstructorFunctionAbi | FallbackFunctionAbi | FunctionFunctionAbi | ReceiveFunctionAbi;

export interface EventParameter extends Parameter {
  indexed: boolean;
}

export interface EventAbi {
  type: "event";
  name: string;
  inputs: EventParameter[];
  anonymous: boolean;
}

export interface ErrorAbi {
  type: "error";
  name: string;
  inputs: Parameter[];
}

export type AbiElementType = FunctionType | "event" | "error";

export type AbiElement = FunctionAbi | EventAbi | ErrorAbi;

export type Abi = AbiElement[];
