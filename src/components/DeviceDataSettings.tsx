import { translate } from "../shared/lib/i18n";
import { Tooltip } from "../shared/ui";
import { useEffect, useState } from "react";
import { invoke } from "../electronBridge";
import {
  DEVICE_DATA_GROUPS,
  PRIVACY_POLICY_URL,
  type DeviceDataGroup,
  type DeviceDataStatus,
} from "../lib/deviceData";

export function DeviceDataGroups({
  status,
  onChange,
}: {
  status: DeviceDataStatus;
  onChange: (group: DeviceDataGroup, enabled: boolean) => void;
}) {
  return (
    <div className="settings-device-data">
      <div className="settings-device-data-head">
        <span className="muted small">{translate("Device data")}</span>
        <a className="small" href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">{translate("Privacy Policy")}</a>
      </div>
      <div className="muted small settings-device-data-note">{translate("Sent with your account to speed up support and plan product work. Turning a group off also deletes what was stored for it.")}{!status.available && translate(" This build does not send device data.")}
      </div>
      <div className="settings-device-data-list">
        {DEVICE_DATA_GROUPS.map((group) => (
          <Tooltip key={group.key} content={group.detail}><div className="settings-device-data-row">
            <span className="settings-device-data-copy">
              <span className="small">{group.label}</span>
              <span className="muted small">{group.summary}</span>
            </span>
            <label className="toggle">
              <input
                type="checkbox"
                aria-label={translate("Send %1 data", group.label.toLowerCase())}
                checked={status.groups[group.key]}
                onChange={(event) => onChange(group.key, event.target.checked)}
              />
              <span className="toggle-track"><span className="toggle-knob" /></span>
            </label>
          </div></Tooltip>
        ))}
      </div>
    </div>
  );
}

export function DeviceDataSettings() {
  const [status, setStatus] = useState<DeviceDataStatus>();
  useEffect(() => {
    let active = true;
    void invoke<DeviceDataStatus>("client_environment_status")
      .then((next) => { if (active) setStatus(next); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const change = (group: DeviceDataGroup, enabled: boolean) => {
    const apply = (value: boolean) => setStatus((current) => current && { ...current, groups: { ...current.groups, [group]: value } });
    apply(enabled);
    void invoke<DeviceDataStatus>("client_environment_set", { group, enabled })
      .then(setStatus)
      .catch(() => apply(!enabled));
  };
  if (!status) return null;
  return <DeviceDataGroups status={status} onChange={change} />;
}
