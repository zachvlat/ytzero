import type { ReactNode } from "react";
import { cx } from "./utils";
import "./PermissionMatrix.css";

/** A large-data table with pinned identity columns and domain-rendered cells. */
export function PermissionMatrix<Row extends { id: number | string }>({ rows, columns, corner, secondaryHeader, renderRow, renderSecondary, renderCell, rowDisabled }: {
  rows: readonly Row[];
  columns: readonly { id: string; label: ReactNode }[];
  corner: ReactNode;
  secondaryHeader: ReactNode;
  renderRow: (row: Row) => ReactNode;
  renderSecondary: (row: Row) => ReactNode;
  renderCell: (row: Row, columnId: string) => ReactNode;
  rowDisabled?: (row: Row) => boolean;
}) {
  return <div className="ui-permission-matrix-wrap"><table className="ui-permission-matrix">
    <thead><tr><th className="ui-permission-matrix__identity" scope="col">{corner}</th><th className="ui-permission-matrix__secondary" scope="col">{secondaryHeader}</th>{columns.map((column) => <th key={column.id} scope="col">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className={cx(rowDisabled?.(row) && "ui-permission-matrix__row--disabled")}>
      <th className="ui-permission-matrix__identity" scope="row">{renderRow(row)}</th>
      <td className="ui-permission-matrix__secondary">{renderSecondary(row)}</td>
      {columns.map((column) => <td key={column.id}>{renderCell(row, column.id)}</td>)}
    </tr>)}</tbody>
  </table></div>;
}
