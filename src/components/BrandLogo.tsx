// Official Nextbrowser mark sourced from https://www.nextbrowser.com.

export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="./nextbrowser-logo.svg"
      width={size}
      height={size}
      alt="Nextbrowser"
      aria-label="Nextbrowser"
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
        <div className="brand-title">Nextbrowser</div>
        {subtitle && <div className="muted small">{subtitle}</div>}
      </div>
    </div>
  );
}
