import PropTypes from "prop-types";
import { useDrizzleStatePromise } from "..";

const Initializer = ({ children, error, loadingContractsAndAccounts, loadingWeb3 }) => {
  const drizzleState = useDrizzleStatePromise((drizzleState, resolvePromise) => {
    resolvePromise({
      drizzleStatusInitialized: drizzleState.drizzleStatus.initialized,
      web3Status: drizzleState.web3.status
    });
  });
  if (drizzleState.resolvedValuedrizzleStatusInitialized) return children;
  if (drizzleState.resolvedValue.web3Status === "initialized") return loadingContractsAndAccounts;
  if (drizzleState.resolvedValue.web3Status === "failed") return error;
  return loadingWeb3;
};

Initializer.propTypes = {
  children: PropTypes.node.isRequired,
  error: PropTypes.node,
  loadingContractsAndAccounts: PropTypes.node,
  loadingWeb3: PropTypes.node
};

Initializer.defaultProps = {
  error: "Error.",
  loadingContractsAndAccounts: "Loading contracts and accounts.",
  loadingWeb3: "Loading web3."
};

export default Initializer;
