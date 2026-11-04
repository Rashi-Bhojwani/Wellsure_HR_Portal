import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as parityApi from "../../../../api/parity";
import { RevealButton } from "../../../../components/common/RevealButton";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { toast } from "../../../../ui";

/** A-9 G1 (item 5): another person's contact numbers arrive masked; this asks for a reason and shows them in full (the server records who, when and why). */
export function useContactReveal(employeeId: string) {
  const [revealed, setRevealed] = useState<{ mobile: string; emergencyContactPhone: string } | null>(null);
  const reveal = useMutation({
    mutationFn: (reason: string) => parityApi.revealContact(employeeId, reason),
    onSuccess: setRevealed,
    onError: (err) => toast.error(errorMessage(err, "Could not show the numbers.")),
  });
  const button = <RevealButton label="Show contact numbers" loading={reveal.isPending} onReveal={(reason) => reveal.mutate(reason)} />;
  return { revealed, button };
}
