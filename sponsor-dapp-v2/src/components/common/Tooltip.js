import React, { Component } from 'react';
import classNames from 'classnames';

import IconSvgComponent from 'components/common/IconSvgComponent';

class Tooltip extends Component {
	state = {
		isActive: false
	};
	showTooltip = () => {
		this.setState({ isActive: true });
		document.addEventListener('click', this.hideTooltip);
	};
	hideTooltip = () => {
		this.setState({ isActive: false });
		document.removeEventListener('click', this.hideTooltip);
	};

	render() {
		const tooltipClasses = classNames('tooltip', {
			active: this.state.isActive
		});

		return (
			<div className={tooltipClasses}>
				<button
					className="tooltip__toggle"
					type="button"
					onClick={this.showTooltip}
				>
					{this.props.title}

					<span className="icon">
						<IconSvgComponent
							iconPath="svg/tooltip.svg"
							additionalClass="ico-tooltip"
						/>
					</span>
				</button>

				<div className="tooltip__content">{this.props.children}</div>
			</div>
		);
	}
}

export default Tooltip;
