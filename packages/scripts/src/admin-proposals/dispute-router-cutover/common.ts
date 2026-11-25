import { utils as ethersUtils } from "ethers";

// DisputeRouter proxy deployed on Polygon.
const DEFAULT_ROUTER_ADDRESS = "0x90326E769C9371AFd379eAB03Bbd3c4d4ca4e783";

export const getRouterAddress = (): string =>
  ethersUtils.getAddress(process.env.ROUTER_ADDRESS || DEFAULT_ROUTER_ADDRESS);
