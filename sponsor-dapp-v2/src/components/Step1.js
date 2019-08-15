import React, { Component } from 'react';

import classNames from 'classnames';

import Dropdown from 'components/common/Dropdown';

class Step1 extends Component {
	constructor(props) {
		super(props);

		this.state = {
			allowedToProceed: false
		};

		this.dropdown = React.createRef();
	}

	checkProceeding = status => {
		this.setState({
			allowedToProceed: status
		});
	};

	render() {
		const { data } = this.props;

		const dropdownData = data.assets.map(asset => {
			return `${asset.identifier} (${asset.collateralRequirement})`;
		});

		return (
			<div className="step step--primary">
				<div className="step__content">
					<p>
						Choose an asset
						<span>
							Select the synthetic asset that you’d like to
							borrow. Each synthetic asset has a different
							collateralization requirement (CR). DAI is used as
							collateral for borrowing synthetics.{' '}
						</span>
					</p>

					<p>
						<span>
							Want something else?{' '}
							<a href={data.tellUsLink}>Tell us</a>
						</span>
					</p>
				</div>

				<div className="step__aside">
					<div className="step__entry">
						<Dropdown
							ref={this.dropdown}
							placeholder="Select synthetic asset"
							list={dropdownData}
							onChange={this.checkProceeding}
						/>
					</div>

					<div className="step__actions">
						<a
							href="test"
							onClick={this.props.onNextStep}
							className={classNames('btn', {
								disabled: !this.state.allowedToProceed
							})}
						>
							Next
						</a>
					</div>
				</div>
			</div>
		);
	}
}

export default Step1;
