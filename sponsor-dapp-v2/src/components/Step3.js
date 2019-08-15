import React, { Component } from 'react';

import classNames from 'classnames';

class Step3 extends Component {
	constructor(props) {
		super(props);

		this.state = {
			allowedToProceed: true,
			isLoading: false
		};
	}

	checkProceeding = status => {
		this.setState({
			allowedToProceed: status
		});
	};

	handleClick(event) {
		event.preventDefault();
		event.persist();

		this.setState(
			{
				isLoading: true
			},
			() => this.props.onNextStep(event)
		);
	}

	render() {
		return (
			<div className="step step--tertiary">
				<div className="step__content">
					<p>
						Launch token facility
						<span>
							Confirm the parameters of the token facility{' '}
						</span>
					</p>
				</div>

				<div className="step__aside">
					<div className="step__entry">
						<ul className="list-selections">
							<li>
								Assets: <span>{this.props.assets}</span>
							</li>

							<li>
								Collateralization requirement:{' '}
								<span>{this.props.requirement}</span>
							</li>

							<li>
								Expiry: <span>{this.props.expiry}</span>
							</li>
						</ul>
					</div>

					<div className="step__actions">
						<a
							href="test"
							className="btn btn--alt"
							onClick={this.props.onPrevStep}
						>
							Back
						</a>

						<a
							href="test"
							onClick={e => this.handleClick(e)}
							className={classNames('btn has-loading', {
								disabled: !this.state.allowedToProceed,
								'is-loading': this.state.isLoading
							})}
						>
							<span>Create Contract</span>

							<span className="loading-text">Processing</span>

							<strong className="dot-pulse" />
						</a>
					</div>
				</div>
			</div>
		);
	}
}

export default Step3;
