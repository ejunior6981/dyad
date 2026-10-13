// Custom fork: local subagents inherit the root model and have no Pro billing.
import { getAuxiliarySettings } from "./auxiliaryModel";
import {
  isLocalModelSelection,
  type ModelSelection,
  type UserSettings,
} from "./schemas";

export function withoutLocalHostedBilling(
  settings: UserSettings,
): UserSettings {
  return isLocalModelSelection(settings.selectedModel)
    ? { ...settings, enableDyadPro: false, proModelUsage: "api-key" }
    : settings;
}

export function getAgentModelSettings(
  settings: UserSettings,
  hostedModel: ModelSelection,
): UserSettings & { selectedModel: ModelSelection } {
  if (isLocalModelSelection(settings.selectedModel)) {
    return {
      ...settings,
      enableDyadPro: false,
      proModelUsage: "api-key",
      selectedModel: {
        ...settings.selectedModel,
        connection: "api-key",
        effortLevel:
          (settings.selectedModel as Partial<ModelSelection>).effortLevel ??
          hostedModel.effortLevel,
      },
    };
  }
  return { ...getAuxiliarySettings(settings), selectedModel: hostedModel };
}
