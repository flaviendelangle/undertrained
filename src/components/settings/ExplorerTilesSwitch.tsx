import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { useExplorerTilesToggle } from "~/hooks/useExplorerTilesToggle";
import { useT } from "~/i18n/useT";

export function ExplorerTilesSwitch() {
  const t = useT();
  const { showExplorerTiles, setShowExplorerTiles } = useExplorerTilesToggle();

  return (
    <Label className="flex items-center gap-2">
      <Switch
        checked={showExplorerTiles}
        onCheckedChange={(checked) => setShowExplorerTiles(checked)}
      />
      {t("nav.toggle.explorerTiles")}
    </Label>
  );
}
