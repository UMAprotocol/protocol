import { DefaultConfig, getAddress, getMulticall2Address } from "../common/utils";
// this had to be copied in because interfaces in contracts-frontend and contracts-node are different
// The frontend cant use contracts-node because async calls are required for addresses, when testing in node
// we arent able to import contracts-frontend.
export function getOptimisticOracleAddress(chainId: number): string {
  switch (chainId.toString()) {
    case "1":
      return getAddress("0xc43767f4592df265b4a9f1a398b97ff24f38c6a6");
    case "4":
      return getAddress("0x3746badD4d6002666dacd5d7bEE19f60019A8433");
    case "10":
      return getAddress("0x56e2d1b8C7dE8D11B282E1b4C924C32D91f9102B");
    case "42":
      return getAddress("0xB1d3A89333BBC3F5e98A991d6d4C1910802986BC");
    case "100":
      return getAddress("0xd2ecb3afe598b746F8123CaE365a598DA831A449");
    case "137":
      return getAddress("0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49");
    case "288":
      return getAddress("0x7da554228555C8Bf3748403573d48a2138C6b848");
    case "42161":
      return getAddress("0x031A7882cE3e8b4462b057EBb0c3F23Cd731D234");
    case "80001":
      return getAddress("0xAB75727d4e89A7f7F04f57C00234a35950527115");
    default:
      throw new Error(`No address found for deployment OptimisticOracle on chainId ${chainId}`);
  }
}
export const defaultConfig = DefaultConfig({ getOptimisticOracleAddress, getMulticall2Address });
