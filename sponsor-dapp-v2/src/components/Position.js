import React from "react";
import { Link } from "react-router-dom";

import Tooltip from "components/common/Tooltip";

function Position(props) {
  const { position, index, totalLength } = props;

  return (
    <div className="position">
      <div className="position__head">
        <ul className="list-info">
          <li>
            Address:{" "}
            <a href={position.address.link} target="_blank" rel="noopener noreferrer">
              {position.address.display.slice(0, 2)}...
              {position.address.display.slice(-5)}
            </a>
          </li>

          <li>Token name: {position.tokenName}</li>

          <li>Liquidation price: {position.liquidationPrice}</li>
        </ul>

        <span className="status">
          {index + 1} of {totalLength}
        </span>
      </div>

      <div className="position__body">
        <div className="position__table">
          <table>
            <thead>
              <tr>
                <th>&nbsp;</th>
                <th>
                  Direction of risk
                  <Tooltip>
                    <p>
                      <span>Direction of risk</span> shows whether owning a position gives you long or short exposure.
                    </p>
                  </Tooltip>
                </th>

                <th>
                  Total exposure
                  <Tooltip>
                    <p>
                      <span>Total exposure</span> is the amount of risk that has been created. The total amount of short
                      (token facility) exposure always equals the total amount of long (tokens) exposure.
                    </p>
                  </Tooltip>
                </th>

                <th>
                  Your exposure
                  <Tooltip>
                    <p>
                      <span>Your exposure</span> is how many units of risk that you own.
                    </p>
                  </Tooltip>
                </th>

                <th>Manage</th>
              </tr>
            </thead>

            <tbody>
              {position.exposures.map((exposure, eIdx) => {
                if (exposure.type === "tokenFacility") {
                  return (
                    <tr key={`row-${eIdx}`}>
                      <td>Token facility</td>

                      <td>
                        <strong>
                          <span>{exposure.items.direction}</span>
                        </strong>
                      </td>

                      <td>
                        <strong>
                          <span>{exposure.items.totalExposure}</span>
                        </strong>
                      </td>

                      <td>
                        <strong>
                          <span>{exposure.items.yourExposure}</span>
                        </strong>
                      </td>

                      <td>
                        <Link to={"/ManagePositions/" + position.address.display} className="btn">
                          Manage position
                        </Link>
                      </td>
                    </tr>
                  );
                }

                if (exposure.type === "tokens") {
                  return (
                    <tr key={`row-${eIdx}`}>
                      <td>Tokens</td>

                      <td>
                        <strong>{exposure.items.direction}</strong>
                      </td>

                      <td>
                        <strong>{exposure.items.totalExposure}</strong>
                      </td>

                      <td>
                        <strong>{exposure.items.yourExposure}</strong>
                      </td>

                      <td>
                        <a href="#" style={{ opacity: "0" }} className="btn">
                          Trade
                        </a>
                      </td>
                    </tr>
                  );
                }

                if (exposure.type === "netExposure") {
                  return (
                    <tr key={`row-${eIdx}`}>
                      <td>Net exposure</td>

                      <td>
                        <strong>{exposure.items.direction}</strong>
                      </td>

                      <td>
                        <strong>{exposure.items.totalExposure}</strong>
                      </td>

                      <td>
                        <strong>{exposure.items.yourExposure}</strong>
                      </td>

                      <td>&nbsp;</td>
                    </tr>
                  );
                }

                return (
                  <tr>
                    <td>No data</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Position;
