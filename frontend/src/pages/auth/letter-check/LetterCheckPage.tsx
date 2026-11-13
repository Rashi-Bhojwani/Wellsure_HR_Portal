import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Upload } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { AuthShell } from "../AuthShell";
import { AuthError } from "../authParts";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, space, v } from "../../../theme/tokens";
import { StatusChip } from "../../../ui";
import { apiClient } from "../../../api/client";

// M session block 2, LT-09: anyone holding one of our letters (a bank, a landlord) checks it is genuine, without signing in. The PDF is compared with
// the fingerprint kept when the letter was issued; the answer carries no personal data.
type Result = { genuine: false } | { genuine: true; reference: string; letter: string; issuedOn: string; replacedByALaterLetter: boolean; signatures: Array<{ position: number; signedOn: string | null }> };

export function LetterCheckPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const check = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      setResult((await apiClient.post<Result>("/api/public/letter-check", form)).data);
    } catch (e) {
      setError(apiErrorMessage(e, "Could not check the file. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Check a letter" subtitle="Upload the PDF of a letter we issued to see whether it is genuine and unchanged.">
      <AuthError message={error} />
      <Upload accept="application/pdf,.pdf" maxCount={1} showUploadList={false} beforeUpload={(file) => { void check(file); return false; }}>
        <Button type="primary" size="large" block icon={<UploadOutlined />} loading={busy}>Choose the PDF</Button>
      </Upload>
      {result && (
        <div role="status" style={{ marginTop: space[4], display: "flex", flexDirection: "column", gap: space[2] }}>
          {result.genuine ? (
            <>
              <StatusChip tone={result.replacedByALaterLetter ? "warning" : "success"}>{result.replacedByALaterLetter ? "Genuine, but replaced by a later letter" : "Genuine and unchanged"}</StatusChip>
              <span style={{ color: v.textPrimary }}>{result.letter} · {result.reference}</span>
              <span style={{ color: v.textSecondary, fontSize: fs.sm }}>Issued on {result.issuedOn}. {result.signatures.length ? `Signed electronically by ${result.signatures.length} signator${result.signatures.length === 1 ? "y" : "ies"}${result.signatures[0]?.signedOn ? ` (from ${result.signatures[0].signedOn})` : ""}.` : "Issued without a signatory."}</span>
            </>
          ) : (
            <>
              <StatusChip tone="danger">Not recognised</StatusChip>
              <span style={{ color: v.textSecondary, fontSize: fs.sm }}>This file is not a letter we issued, or it was changed after it was issued. Ask the person for the original file.</span>
            </>
          )}
        </div>
      )}
      <div style={{ textAlign: "center", fontSize: fs.md, marginTop: space[4] }}>
        <Link to="/login">Sign in</Link>
      </div>
    </AuthShell>
  );
}
