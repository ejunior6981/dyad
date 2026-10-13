import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SettingField } from "@/components/settings/SettingField";
import {
  DEFAULT_SEARXNG_URL,
  normalizeLocalServiceUrl,
} from "@/shared/local_web_search";

export function LocalWebSearchSettings() {
  const { settings, updateSettings } = useSettings();
  const savedUrl = settings?.searxngBaseUrl ?? DEFAULT_SEARXNG_URL;
  const [url, setUrl] = useState(savedUrl);
  useEffect(() => setUrl(savedUrl), [savedUrl]);
  const saveUrl = async () => {
    try {
      const normalized = normalizeLocalServiceUrl(url.trim());
      if (normalized !== savedUrl)
        await updateSettings({ searxngBaseUrl: normalized });
      setUrl(normalized);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save SearXNG URL.",
      );
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2">
        <Switch
          id="local-web-search"
          aria-label="Local web search"
          checked={settings?.enableLocalWebSearch !== false}
          onCheckedChange={(checked) =>
            void updateSettings({ enableLocalWebSearch: checked })
          }
        />
        <Label htmlFor="local-web-search">Local web search</Label>
      </div>
      <SettingField
        htmlFor="searxng-url"
        label="SearXNG URL"
        description="LM Studio and Ollama agents search through your local SearXNG instance. Enable JSON results in SearXNG. Searches require internet access."
      >
        <Input
          id="searxng-url"
          className="w-full sm:w-[320px]"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onBlur={() => void saveUrl()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </SettingField>
    </div>
  );
}
