
import React, { Component } from 'react';
import { Link } from 'react-router-dom';

import classNames from 'classnames';

import Header from 'components/common/Header';
import IconSvgComponent from 'components/common/IconSvgComponent';

class Borrow extends Component {
	constructor(props) {
		super(props);

		this.state = {
			allowedToProceed: false,
			borrowAmount: '',
			tokens: '',
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
			this.setState({ borrowAmount: event.target.value }, () => {
				this.checkFields();
			});
		}
	}

	handleChangeTokens(event) {
		// Check if regex number matches
		if (/^(\s*|\d+)$/.test(event.target.value)) {
			this.setState({ tokens: event.target.value }, () => {
				this.checkFields();
			});
		}
	}

	checkFields() {
		if (this.state.borrowAmount.length > 0 && this.state.tokens.length > 0) {
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
							<h3>Borrow additional tokens</h3>
						</div>

						<div className="popup__body">
							<div className="popup__col popup__col--offset-bottom">
								<div className="form-group">
									<label
										htmlFor="field-borrow"
										className="form__label"
									>
										How much Dai would you like to collateralize?
									</label>

									<div className="form__controls">
										<input
											type="text"
											className="field"
											id="field-borrow"
											name="field-borrow"
											value={this.state.borrowAmount}
											maxLength="18"
											autoComplete="off"
											disabled={this.state.isLoading}
											onChange={e =>
												this.handleChangeAmount(e)
											}
										/>

										<span>DAI</span>
									</div>
								</div>
							</div>

							<div className="popup__col popup__col--offset-bottom">
								<div className="form-group">
									<label
										htmlFor="field-tokens"
										className="form__label"
									>
										How many synthetic tokens do you want to borrow?
									</label>

									<div className="form__controls">
										<input
											type="text"
											className="field"
											id="field-tokens"
											name="field-tokens"
											value={this.state.tokens}
											maxLength="18"
											autoComplete="off"
											disabled={this.state.isLoading}
											onChange={e =>
												this.handleChangeTokens(e)
											}
										/>

										<span>Tokens</span>
									</div>

									{this.state.allowedToProceed &&
										<div className="form-hint">
											<p>(Max 1)</p>
										</div>
									}
								</div>
							</div>

							<div className="popup__col">
								<dl className="popup__description">
									<dt>Liquidation price [BTC/USD]: 15,400</dt>
									<dd>Current price [BTC/USD]: 14,000 </dd>
								</dl>

								<dl className="popup__description">
									<dt>Collateralization ratio: 112%</dt>
									<dd>Minimum ratio: 110%</dd>
								</dl>
							</div>

							<div className="popup__col">
								<div className="popup__actions">
									<Link to="/ManagePositions"
										onClick={event => this.delayRedirect(event)}
										className={classNames(
											'btn btn--block has-loading',
											{disabled: !this.state.allowedToProceed},
											{'is-loading': this.state.isLoading})}
										>

										<span>Collateralize & borrow tokens</span>

										<span className="loading-text">Processing</span>

										<strong className="dot-pulse"></strong>
									</Link>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>


		);
	}
}

export default Borrow;
