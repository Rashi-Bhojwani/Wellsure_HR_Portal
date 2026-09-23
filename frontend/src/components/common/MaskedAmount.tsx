import { Typography } from "antd";

const { Text } = Typography;

interface MaskedAmountProps {
  value: number;
  revealed: boolean;
  currency?: string;
  color?: string;
}

const formatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

// Home → Payslip widget masks Gross/Deduction/Net as ***** until the card's
// single "Show Salary" toggle is clicked (docs/UI_REFERENCE.md §1.1).
// Purely presentational: the parent card owns the reveal state so several
// amounts can share one toggle.
export function MaskedAmount({ value, revealed, currency = "₹", color }: MaskedAmountProps) {
  return (
    <Text strong style={color ? { color } : undefined}>
      {revealed ? (
        <>
          {currency}
          {formatter.format(value)}
        </>
      ) : (
        "*****"
      )}
    </Text>
  );
}
