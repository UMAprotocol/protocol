/**
 * @ External Dependencies
 */
import { createAction } from "redux-actions";
import axios from "axios";

/**
 * @ Action creators
 */

export const fetchLandingPositionsSuccess = createAction("FETCH_LANDING_POSITIONS_SUCCESS");
export const fetchLandingPositionsError = createAction("FETCH_LANDING_POSITIONS_ERROR");

export const fetchManagePositionsSuccess = createAction("FETCH_Manage_POSITIONS_SUCCESS");
export const fetchManagePositionsError = createAction("FETCH_Manage_POSITIONS_ERROR");

export function fetchAllPositions() {
  return dispatch => {
    axios
      .get(`./data/landingData.json`)
      .then(res => {
        dispatch(fetchLandingPositionsSuccess(res.data));
        return res.data;
      })
      .catch(error => {
        dispatch(fetchLandingPositionsError(error));
      });

    axios
      .get(`./data/managePositionData.json`)
      .then(res => {
        dispatch(fetchManagePositionsSuccess(res.data));
        return res.data;
      })
      .catch(error => {
        dispatch(fetchManagePositionsError(error));
      });
  };
}
