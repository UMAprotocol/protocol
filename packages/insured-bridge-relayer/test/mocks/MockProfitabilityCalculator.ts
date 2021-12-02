import type { BN } from "@uma/common";

import { ProfitabilityCalculator } from "../../src/ProfitabilityCalculator";

import type { TokenType } from "../../src/ProfitabilityCalculator";

export class MockProfitabilityCalculator extends ProfitabilityCalculator {
  setL1TokenInfo(l1TokenInfo: { [token: string]: { tokenType: TokenType; tokenEthPrice: BN } }) {
    this.l1TokenInfo = l1TokenInfo;
  }
  async update() {
    return;
  }
}
