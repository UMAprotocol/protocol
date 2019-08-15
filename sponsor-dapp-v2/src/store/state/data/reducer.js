/**
 * @ External Dependencies
 */
import { handleActions } from "redux-actions";

/**
 * @ Actions
 */
import { setPageLock, showWelcomePopup } from "./actions";

/**
 * @ Reducer
 */

const defaultState = {
  isLocked: false,
  showWelcome: true
};

/**
 * Actions Handler
 *
 * @type       {Function}
 */
const commonData = handleActions(
  {
    [setPageLock]: (state, { payload }) => ({
      ...state,
      isLocked: payload
    }),
    [showWelcomePopup]: (state, { payload }) => ({
      ...state,
      showWelcome: payload
    })
  },
  defaultState
);

export default commonData;
