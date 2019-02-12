import React from 'react';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableRow from '@material-ui/core/TableRow';

const ContractFinancialsTable = ({lastRemargin, estimatedCurrent}) => (
  <Table>
    <TableBody>
      <TableRow key='assetPrice'>
        <TableCell>Asset price:</TableCell>
        <TableCell>{lastRemargin.assetPrice}</TableCell>
        <TableCell>{estimatedCurrent.assetPrice}</TableCell>
      </TableRow>

      <TableRow key='tokenValue'>
        <TableCell>Token value:</TableCell>
        <TableCell>{lastRemargin.tokenPrice}</TableCell>
        <TableCell>{estimatedCurrent.tokenPrice}</TableCell>
      </TableRow>

      <TableRow key='totalHoldings'>
        <TableCell>Token value:</TableCell>
        <TableCell>{lastRemargin.totalHoldings}</TableCell>
        <TableCell>{estimatedCurrent.totalHoldings}</TableCell>
      </TableRow>

      <TableRow key='longMargin'>
        <TableCell>- Long margin:</TableCell>
        <TableCell>{lastRemargin.longMargin}</TableCell>
        <TableCell>{estimatedCurrent.longMargin}</TableCell>
      </TableRow>

      <TableRow key='shortMargin'>
        <TableCell>- Short margin:</TableCell>
        <TableCell>{lastRemargin.shortMargin}</TableCell>
        <TableCell>{estimatedCurrent.shortMargin}</TableCell>
      </TableRow>

      <TableRow key='tokenSupply'>
        <TableCell>Token supply:</TableCell>
        <TableCell>{lastRemargin.tokenSupply}</TableCell>
        <TableCell>{estimatedCurrent.tokenSupply}</TableCell>
      </TableRow>

      <TableRow key='yourTokens'>
        <TableCell>- Your tokens:</TableCell>
        <TableCell>{lastRemargin.yourTokens}</TableCell>
        <TableCell>{estimatedCurrent.yourTokens}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

export default ContractFinancialsTable;
