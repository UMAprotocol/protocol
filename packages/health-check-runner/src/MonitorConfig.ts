interface ProcessEnv {
  [key: string]: string | undefined;
}
export class MonitorConfig {
  readonly startingBlock: number;
  readonly endingBlock: number;
  readonly customNodeUrl: string;
  readonly votingV2Address: string;

  constructor(env: ProcessEnv) {
    const { STARTING_BLOCK_NUMBER, ENDING_BLOCK_NUMBER, CUSTOM_NODE_URL, VOTINGV2_ADDRESS } = env;
    if (STARTING_BLOCK_NUMBER === undefined || ENDING_BLOCK_NUMBER === undefined) {
      throw new Error("Must provide STARTING_BLOCK_NUMBER and ENDING_BLOCK_NUMBER");
    }
    if (CUSTOM_NODE_URL === undefined) {
      throw new Error("Must provide CUSTOM_NODE_URL");
    }
    if (VOTINGV2_ADDRESS === undefined) {
      throw new Error("Must provide VOTINGV2_ADDRESS");
    }
    this.startingBlock = Number(STARTING_BLOCK_NUMBER);
    this.endingBlock = Number(ENDING_BLOCK_NUMBER);
    this.customNodeUrl = CUSTOM_NODE_URL;
    this.votingV2Address = VOTINGV2_ADDRESS;
  }
}
