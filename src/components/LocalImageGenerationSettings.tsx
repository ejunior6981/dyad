import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SettingField } from "@/components/settings/SettingField";
import {
  DEFAULT_COMFYUI_URL,
  parseLocalImageWorkflow,
} from "@/shared/local_image_generation";
import { normalizeLocalServiceUrl } from "@/shared/local_web_search";

export function LocalImageGenerationSettings() {
  const { settings, updateSettings } = useSettings();
  const savedUrl = settings?.comfyuiBaseUrl ?? DEFAULT_COMFYUI_URL;
  const savedWorkflow = settings?.comfyuiWorkflow ?? "";
  const [url, setUrl] = useState(savedUrl);
  const [workflow, setWorkflow] = useState(savedWorkflow);
  useEffect(() => setUrl(savedUrl), [savedUrl]);
  useEffect(() => setWorkflow(savedWorkflow), [savedWorkflow]);
  const save = async () => {
    try {
      const normalized = normalizeLocalServiceUrl(url.trim());
      if (workflow.trim()) parseLocalImageWorkflow(workflow);
      await updateSettings({
        comfyuiBaseUrl: normalized,
        comfyuiWorkflow: workflow.trim(),
      });
      toast.success("ComfyUI settings saved.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save ComfyUI settings.",
      );
    }
  };
  return (
    <div className="space-y-3">
      <SettingField
        htmlFor="comfyui-url"
        label="ComfyUI URL"
        description="Generate images using your installed local models."
      >
        <Input
          id="comfyui-url"
          className="w-full sm:w-[320px]"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </SettingField>
      <SettingField
        htmlFor="comfyui-workflow"
        label="ComfyUI API workflow"
        description={
          'Export your workflow in API format. Replace the positive prompt text with "{{prompt}}" and, optionally, the seed with "{{seed}}". Use built-in local model nodes and a SaveImage output. Leave blank to disable image generation.'
        }
      >
        <Textarea
          id="comfyui-workflow"
          className="font-mono min-h-36"
          value={workflow}
          onChange={(event) => setWorkflow(event.target.value)}
          maxLength={200_000}
          placeholder="Paste API workflow JSON"
        />
      </SettingField>
      <Button
        variant="outline"
        onClick={() => void save()}
        disabled={url === savedUrl && workflow === savedWorkflow}
      >
        Save image settings
      </Button>
    </div>
  );
}
