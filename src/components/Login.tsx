import { useState } from "react";
import { useStore } from "../store";
import { brandName } from "../constants";
import { BrandLogo } from "./BrandLogo";
import { Spinner } from "./Icon";

export function Login() {
  const login = useStore((s) => s.login);
  const error = useStore((s) => s.loginError);
  const loading = useStore((s) => s.isLoggingIn);
  const [key, setKey] = useState("");

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
          onKeyDown={(e) => e.key === "Enter" && login(key)}
        />
        {error && <div className="error small login-error">{error}</div>}
      </div>

      <button
        className="btn-bordered-prominent login-submit"
        disabled={loading}
        onClick={() => login(key)}
      >
        {loading ? <Spinner size={16} /> : "Sign in"}
      </button>

      <a
        className="login-link"
        href="https://app.nextbrowser.com/dashboard"
        target="_blank"
        rel="noreferrer"
      >
        Get your key in the dashboard →
      </a>
      <div className="login-spacer" />
    </div>
  );
}
