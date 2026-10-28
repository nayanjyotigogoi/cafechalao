"use client";

import { useCallback, useState } from "react";
import { authApi } from "@/modules/auth/api";
import { useM } from "@/shared/api/hooks";
import { Modal } from "@/shared/ui/overlay";
import { PinPad } from "@/shared/ui/pinpad";

/**
 * "Manager PIN on the spot" (SRS 2): when an action is above the user's limit, a manager or owner
 * enters their PIN on this device; the API returns their id, which is sent with the retried action.
 */
export function ApprovalPin({ open, onClose, kind, amount, onApproved, reason }: { open: boolean; onClose: () => void; kind?: string; amount?: number; reason: string; onApproved: (approverId: string, name: string) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const approve = useM((pin: string) => authApi.approve({ pin, kind, amount }), {
    silentError: true,
    onSuccess: (r) => { setErr(null); onApproved(r.approver_id, r.approver_name); },
    onError: (e) => setErr(e.message),
  });
  const submit = useCallback((pin: string) => approve.mutate(pin), [approve]);
  return (
    <Modal open={open} onClose={onClose} title="Manager approval">
      <p className="mb-3 text-center text-sm text-mute">{reason}</p>
      <PinPad onSubmit={submit} busy={approve.isPending} error={err} label="Manager or owner PIN" />
    </Modal>
  );
}
