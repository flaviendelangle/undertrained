import { useT } from "~/i18n/useT";
import type { ExplorerTilesResult } from "~/utils/explorerTiles";

interface ExplorerTilesStatsProps {
  tilesData: ExplorerTilesResult | null;
  visible: boolean;
}

export function ExplorerTilesStats({
  tilesData,
  visible,
}: ExplorerTilesStatsProps) {
  const t = useT();
  if (!visible || !tilesData) return null;

  const { stats } = tilesData;

  return (
    <div className="bg-background/90 text-foreground absolute bottom-4 left-4 z-1000 rounded-md px-4 py-3 text-sm shadow-lg">
      <div className="mb-1 font-semibold">{t("map.explorerTiles")}</div>
      <div>
        {t("map.visited", { count: stats.totalVisited.toLocaleString() })}
      </div>
      <div>
        {t("map.maxSquare", {
          side: `${stats.maxSquareSide} x ${stats.maxSquareSide}`,
        })}
      </div>
      <div>
        {t("map.largestCluster", {
          count: stats.largestClusterSize.toLocaleString(),
        })}
      </div>
      <div>{t("map.clusters", { count: stats.clusterCount })}</div>
    </div>
  );
}
