import thunk from "redux-thunk";
import drizzleOptions from "drizzleOptions";
import { generateStore } from "drizzle";

/**
 * @ Reducers
 */
import commonData from "./state/data/reducer";
import positionsData from "./state/positions/reducer";
import stepsData from "./state/steps/reducer";

export default generateStore({
  drizzleOptions,
  appReducers: { commonData, positionsData, stepsData },
  appMiddlewares: [thunk]
});
