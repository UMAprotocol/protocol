import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router-dom';

import Header from 'components/common/Header';
import ExpandBox from 'components/common/ExpandBox';
import Tooltip from 'components/common/Tooltip';

class ManagePositions extends Component {

	render() {
		const { managePosition } = this.props;

		if (!managePosition) {
			return null;
		}

		const { address } = managePosition.contractStatus;

		return (
			<div className="wrapper">
				<Header />

				<div className="main">
					<div className="shell">
						<section className="section-edit">
							<Link to="/ViewPositions" className="link-default">
								View all contracts
							</Link>

							<div className="section__head">
								<div className="section__head-aside">
									<div className="section__status">
										<span>
											{address.display.slice(0, 8)}...
											{address.display.slice(-1)}
										</span>

										<div className="indicator">
											<span
												className="icon"
												style={{
													backgroundColor: `${
														managePosition
															.contractStatus
															.statusColor
													}`
												}}
											/>
											{
												managePosition.contractStatus
													.statusText
											}
										</div>
									</div>
								</div>

								{managePosition.details && (
									<div className="section__head-content">
										<ExpandBox
											title="Details"
											content={managePosition.details}
										/>
									</div>
								)}
							</div>

							<div className="section__body">
								<div className="detail-box">
									<div className="detail-box__head">
										<h4>Assets</h4>
									</div>

									<div className="detail-box__body">
										<div className="detail-box__table">
											<table>
												<tbody>
													<tr>
														<td>
															Asset price
															<Tooltip>
																<p> <span> Asset price </span>  is cash or equity in a margin trading account beyond what is required to open or maintain the account. </p>
															</Tooltip>
														</td>

														<td><strong>{managePosition.assets[0].items.value}</strong></td>
													</tr>

													<tr>
														<td>
															Value
															<Tooltip>
																<p> <span> Value </span>  is cash or equity in a margin trading account beyond what is required to open or maintain the account. </p>
															</Tooltip>
														</td>

														<td>
															<strong>{managePosition.assets[1].items.value} DAI</strong>
														</td>
													</tr>
												</tbody>
											</table>
										</div>
									</div>
								</div>

								<div className="detail-box">
									<div className="detail-box__head">
										<h4>Collateral</h4>
									</div>

									<div className="detail-box__body">
										<div className="detail-box__table">
											<table>
												<tbody>
													<tr>
														<td>
															Total collateral
															<Tooltip>
																<p> <span> Total collateral </span> Lorem ipsum dolor sit amet.</p>
															</Tooltip>
														</td>

														<td>
															<strong>
																{managePosition.collateral[0].items.amount.absolute} DAI ({managePosition.collateral[0].items.amount.percentage}%)

															</strong>
														</td>

														<td><strong>(min. {managePosition.collateral[0].items.liquidation} needed to avoid liquidation)</strong></td>
													</tr>

													<tr>
														<td>
															Token debt
															<Tooltip>
																<p><span>Token debt</span> Lorem ipsum dolor sit amet.</p>
															</Tooltip>
														</td>

														<td>
															<strong>{managePosition.collateral[1].items.amount.absolute} DAI</strong>
														</td>

														<td>&nbsp;</td>
													</tr>

													<tr>
														<td>
															Excess collateral
															<Tooltip>
																<p> <span>Excess collateral</span> Lorem ipsum dolor sit amet.</p>
															</Tooltip>
														</td>

														<td>
															<strong>{managePosition.collateral[2].items.amount.absolute} DAI</strong>
														</td>

														<td><strong>(min. {managePosition.collateral[2].items.liquidation} DAI needed to avoid liquidation)</strong></td>
													</tr>
												</tbody>
											</table>
										</div>

										<div className="detail-box__actions">
											<Link
												to="/Withdraw"
												className='btn'
											>
												<span>Withdraw collateral</span>
											</Link>

											<Link
												to="/Deposit"
												className='btn'
											>
												<span>Deposit additional collateral</span>
											</Link>
										</div>
									</div>
								</div>

								<div className="detail-box">
									<div className="detail-box__head">
										<h4>Tokens</h4>
									</div>

									<div className="detail-box__body">
										<div className="detail-box__table">
											<table>
												<tbody>
													<tr>
														<td>
															Token supply
															<Tooltip>
																<p><span>Token supply</span> Lorem ipsum dolor sit amet.</p>
															</Tooltip>
														</td>

														<td>
															<strong>
																{managePosition.tokens[0].items.amount.absolute} Tokens

															</strong>
														</td>

														<td>&nbsp;</td>
													</tr>

													<tr>
														<td>
															Your tokens
															<Tooltip>
																<p> <span>Your tokens</span> Lorem ipsum dolor sit amet.</p>
															</Tooltip>
														</td>

														<td>
															<strong>{managePosition.tokens[1].items.amount.absolute} ({managePosition.tokens[1].items.amount.percentage}%)</strong>
														</td>

														<td><strong>({managePosition.tokens[1].items.value} DAI)</strong></td>
													</tr>
												</tbody>
											</table>
										</div>

										<div className="detail-box__actions">
											<Link
												to="/Borrow"
												className='btn'
											>
												<span>Borrow more tokens</span>
											</Link>

											<Link
												to="/Repay"
												className='btn'
											>
												<span>Repay token debt</span>
											</Link>
										</div>
									</div>
								</div>
							</div>
						</section>
					</div>
				</div>
			</div>
		);
	}
}

export default connect(
	state => ({
		managePosition: state.positionsData.managePositions
	}),
	{
		// fetchAllPositions
	}
)(ManagePositions);
