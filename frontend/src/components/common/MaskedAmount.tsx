import { useState } from "react";
import { Button, Typography } from "antd";
import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";

const { Text } = Typography;

interface MaskedAmountProps {
  value: number;
  currency?: string;
  color?: string;
  defaultRevealed?: boolean;
}

const formatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

// Home → Payslip widget masks Gross/Deduction/Net as ***** until "Show
// Salary" is clicked (docs/UI_REFERENCE.md §1.1).
export function MaskedAmount({ value, currency = "₹", color, defaultRevealed = false }: MaskedAmountProps) {
  const [revealed, setRevealed] = useState(defaultRevealed);

  return (
    <Text strong style={color ? { color } : undefined}>
      {revealed ? (
        <>
          {currency}
          {formatter.format(value)}
        </>
      ) : (
        "*****"
      )}{" "}
      <Button
        type="link"
        size="small"
        onClick={() => setRevealed((r) => !r)}
        icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
      >
        {revealed ? "Hide" : "Show Salary"}
      </Button>
    </Text>
  );
}
