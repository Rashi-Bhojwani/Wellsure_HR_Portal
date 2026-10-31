import { OfficeGate } from "../../peeps/OfficeGate";
import { AssetRegisterPage } from "./AssetRegisterPage";
import { AssetSettingsPage } from "./AssetSettingsPage";

// The asset screens as they appear inside the Wellsure Office workspace (D-29, Q-14): directors and members who manage the register only.
export function OfficeAssetRegisterPage() {
  return (
    <OfficeGate title="Asset Register" need="MANAGE_ASSETS">
      <AssetRegisterPage />
    </OfficeGate>
  );
}

export function OfficeAssetSettingsPage() {
  return (
    <OfficeGate title="Asset Settings" need="MANAGE_ASSETS">
      <AssetSettingsPage />
    </OfficeGate>
  );
}
