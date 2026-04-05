import { useState, useCallback, useEffect, useRef } from "react";
import { parseContractError } from "../config/contract";

/**
 * Wraps a contract write call with loading / success / error states.
 * Auto-dismisses success status after 5 seconds.
 *
 * Usage:
 *   const { execute, status, txHash, error } = useTransaction();
 *   await execute(() => contract.deposit({ value: ... }));
 */
export function useTransaction() {
  const [status, setStatus] = useState("idle"); // idle | pending | mining | success | error
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const autoDismissTimer = useRef(null);

  // Clear any pending auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    };
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setTxHash(null);
    setError(null);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
  }, []);

  const execute = useCallback(async (txFn, onSuccess) => {
    setStatus("pending");
    setTxHash(null);
    setError(null);
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);

    try {
      const tx = await txFn();
      setTxHash(tx.hash);
      setStatus("mining");
      const receipt = await tx.wait();
      setStatus("success");

      // Auto-dismiss success after 5 seconds
      autoDismissTimer.current = setTimeout(() => {
        setStatus("idle");
        setTxHash(null);
        setError(null);
      }, 5000);

      if (onSuccess) {
        try {
          await onSuccess({ tx, receipt });
        } catch (postSuccessError) {
          console.error("Post-transaction refresh failed:", postSuccessError);
        }
      }
    } catch (err) {
      console.error("Transaction failed:", err);
      setError(parseContractError(err));
      setStatus("error");
    }
  }, []);

  return { execute, status, txHash, error, reset };
}
