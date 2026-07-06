import { useState } from "react";
import { useStore } from "../store";
import { brandName, dashboardUrl } from "../constants";
import { BrandLogo } from "./BrandLogo";
import { Spinner } from "./Icon";

export function Login() {
  const login = useStore((s) => s.login);
  const error = useStore((s) => s.loginError);
  const loading = useStore((s) => s.isLoggingIn);
  const [key, setKey] = useState("");
  const canSubmit = !!key.trim() && !loading;

  return (
    <div className="login">
      <div className="login-spacer" />
      <BrandLogo size={76} />
      <h1>{brandName}</h1>
      <p className="login-subtitle">Sign in with your dashboard API key</p>

      <div className="login-fields">
        <input
          className="login-input"
          type="password"
          placeholder="nextbrowser API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) void login(key);
          }}
        />
        {error && <div className="error small login-error">{error}</div>}
      </div>

      <button
        className="btn-bordered-prominent login-submit"
        disabled={!canSubmit}
        onClick={() => void login(key)}
      >
        {loading ? <Spinner size={16} /> : "Sign in"}
      </button>

      <a
        className="login-link"
        href={dashboardUrl}
        target="_blank"
        rel="noreferrer"
      >
        Get your key in the dashboard →
      </a>
      <div className="login-spacer" />
    </div>
  );
}
