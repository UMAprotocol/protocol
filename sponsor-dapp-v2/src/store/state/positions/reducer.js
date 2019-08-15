/**
 * @ External Dependencies
 */
import { handleActions } from "redux-actions";

/**
 * @ Actions
 */
import {
  fetchLandingPositionsSuccess,
  fetchLandingPositionsError,
  fetchManagePositionsSuccess,
  fetchManagePositionsError
} from "./actions";

/**
 * @ Reducer
 */

const defaultState = {
  landingPositions: null,
  landingPositionsError: false,
  managePositions: null,
  managePositionsError: false
};

/**
 * Actions Handler
 *
 * @type       {Function}
 */
const positionsData = handleActions(
  {
    [fetchLandingPositionsSuccess]: (state, { payload }) => ({
      ...state,
      landingPositions: payload,
      landingPositionsError: false
    }),
    [fetchLandingPositionsError]: (state, { payload }) => ({
      ...state,
      landingPositionsError: true
    }),

    [fetchManagePositionsSuccess]: (state, { payload }) => ({
      ...state,
      managePositions: payload,
      managePositionsError: false
    }),
    [fetchManagePositionsError]: (state, { payload }) => ({
      ...state,
      managePositionsError: true
    })
  },
  defaultState
);

export default positionsData;
