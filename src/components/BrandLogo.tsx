// Official NextBrowser mark sourced from https://www.nextbrowser.com.

export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="./nextbrowser-logo.svg"
      width={size}
      height={size}
      alt="NextBrowser"
      aria-label="NextBrowser"
      className="brand-logo"
      draggable={false}
    />
  );
}

export function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <BrandLogo size={28} />
      <div>
        <div className="brand-title">NextBrowser</div>
        {subtitle && <div className="muted small">{subtitle}</div>}
      </div>
    </div>
  );
}
