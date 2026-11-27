import { translate } from "../shared/lib/i18n";
export interface PersonalProxyTestState {
  status: "testing" | "ok" | "fail";
  detail: string;
}

// The Test button only swaps its icon, so the outcome is spelled out under
// the proxy row: a calm line when the proxy answered, the reason when not.
export function PersonalProxyTestStatus({ test }: { test?: PersonalProxyTestState }) {
  if (test?.status === "ok") {
    return <p className="personal-proxy-test-ok" role="status">{test.detail}</p>;
  }
  if (test?.status === "fail") {
    return <p className="personal-proxy-test-error" role="alert">{test.detail} <span>{translate("Check the proxy details, then press Test to retry.")}</span></p>;
  }
  return null;
}
