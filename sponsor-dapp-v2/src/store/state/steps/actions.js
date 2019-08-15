/**
 * @ External Dependencies
 */
import { createAction } from 'redux-actions';
import axios from 'axios';

/**
 * @ Action creators
 */

export const fetchFirstStepsSuccess = createAction('FETCH_FIRST_STEPS_SUCCESS');
export const fetchFirstStepsError = createAction('FETCH_FIRST_STEPS_ERROR');

export const fetchLastStepsSuccess = createAction('FETCH_LAST_STEPS_SUCCESS');
export const fetchLastStepsError = createAction('FETCH_LAST_STEPS_ERROR');

export function fetchAllSteps() {
	return dispatch => {
		axios
			.get(`./data/setup123Data.json`)
			.then(res => {
				dispatch(fetchFirstStepsSuccess(res.data));
				return res.data;
			})
			.catch(error => {
				dispatch(fetchFirstStepsError(error));
			});

		axios
			.get(`./data/setup456Data.json`)
			.then(res => {
				dispatch(fetchLastStepsSuccess(res.data));
				return res.data;
			})
			.catch(error => {
				dispatch(fetchLastStepsError(error));
			});
	};
}
