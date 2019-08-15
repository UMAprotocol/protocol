
import React, { Component } from 'react';
import { Link } from 'react-router-dom';

import classNames from 'classnames';

import Header from 'components/common/Header';
import IconSvgComponent from 'components/common/IconSvgComponent';

class Withdraw extends Component {
	constructor(props) {
		super(props);

		this.state = {
			allowedToProceed: false,
			withdrawAmount: '',
			newAmount: '115 %',
			isLoading: false
		};
	}

	checkProceeding = status => {
		this.setState({
			allowedToProceed: status
		});
	};

	handleChangeAmount(event) {
		// Check if regex number matches
		if (/^(\s*|\d+)$/.test(event.target.value)) {
			this.setState({ withdrawAmount: event.target.value }, () => {
				this.checkFields();
			});
		}
	}

	checkFields() {
		if (this.state.withdrawAmount.length > 0) {
			this.checkProceeding(true);
		} else {
			this.checkProceeding(false);
		}
	}

	delayRedirect = (event) => {
		const { history: { replace } } = this.props;
		event.preventDefault();

		const page = event.currentTarget.getAttribute('href');

		this.setState({
			isLoading: true
		}, () => setTimeout( () => replace(page), 5000))

	}

	render() {
		return (
			<div className="popup">
				<Header />

				<Link to="/ManagePositions" className="btn-close">
					<IconSvgComponent
						iconPath="svg/ico-close.svg"
						additionalClass="ico-close"
					/>
				</Link>

				<div className="popup__inner">
					<div className="shell">
						<div className="popup__head">
							<h3>Withdraw collateral from facility</h3>

							<div className="popup__head-entry">
								<p><strong>Your facility has a 110% collateralization requirement.</strong> You can withdraw collateral from your facility as long as you maintain this requirement. </p>
							</div>
						</div>

						<div className="popup__body">
							<div className="popup__col">
								<div className="form-group">
									<label
										htmlFor="field-withdraw"
										className="form__label"
									>
										Withdraw margin
									</label>

									<div className="form__controls">
										<input
											type="text"
											className="field"
											id="field-withdraw"
											name="field-withdraw"
											maxLength="18"
											value={this.state.withdrawAmount}
											onChange={e =>
												this.handleChangeAmount(e)
											}
											autoComplete="off"
											disabled={this.state.isLoading}
										/>

										<span>DAI</span>
									</div>
								</div>
							</div>

							<div className="popup__col">
								<div className="popup__entry">
									<p><strong>Facility collateralization</strong></p>

									<ul>
										<li>
											<span>Current:</span>
											<span>113.4%</span>
										</li>

										<li className={classNames({highlight: this.state.allowedToProceed})}>
											<strong>New:</strong>
											<span>
												{!this.state.allowedToProceed ?  '-- %' : this.state.newAmount}
											</span>
										</li>
									</ul>
								</div>
							</div>
						</div>

						<div className="popup__actions">

							<Link to="/ManagePositions"
								onClick={event => this.delayRedirect(event)}
								className={classNames(
									'btn btn--size2 has-loading',
									{disabled: !this.state.allowedToProceed},
									{'is-loading': this.state.isLoading})}
								>

								<span>Withdraw</span>

								<span className="loading-text">Processing</span>

								<strong className="dot-pulse"></strong>
							</Link>
						</div>
					</div>
				</div>
			</div>


		);
	}
}

export default Withdraw;
