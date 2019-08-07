import { makeStyles } from "@material-ui/styles";

export const useTableStyles = makeStyles(theme => ({
  root: {
    padding: "10px"
  },
  tableHeader: {
    background: "#b2b7bf"
  },
  tableHeaderCell: {
    fontWeight: "750"
  },
  tableBody: {
    background: "#e4e7ed"
  }
}));
