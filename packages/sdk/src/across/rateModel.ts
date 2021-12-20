import { expectedRateModelKeys, RateModel } from "./constants";

// Helper method that returns parsed rate model from string, or throws.
export const parseAndReturnRateModelFromString = (rateModelString: string): RateModel => {
  const rateModelFromEvent = JSON.parse(rateModelString);

  // Rate model must contain all keys in `expectedRateModelKeys`, and extra keys are OK.
  for (const key in expectedRateModelKeys) {
    if (!(key in Object.keys(rateModelFromEvent))) {
      throw new Error(
        `Rate model does not contain all expected keys. Expected keys: [${expectedRateModelKeys}], actual keys: [${Object.keys(
          rateModelFromEvent
        )}]`
      );
    }
  }

  return {
    UBar: rateModelFromEvent.UBar,
    R0: rateModelFromEvent.R0,
    R1: rateModelFromEvent.R1,
    R2: rateModelFromEvent.R2,
  };
};
