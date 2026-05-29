import * as React from "react";

export type TileStyle = "street" | "satellite";

// Street: standard OpenStreetMap raster tiles
//   https://wiki.openstreetmap.org/wiki/Raster_tile_providers
// Satellite: Esri World Imagery (free, no API key required), with the Esri
//   Boundaries and Places reference layer stacked on top for labels.
//   https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
export const TILE_PROVIDERS: Record<
  TileStyle,
  { url: string; attribution: string; labelsUrl?: string }
> = {
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      'Map data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labelsUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution:
      'Tiles &copy; <a href="https://www.esri.com">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
};

interface TileStyleContextValue {
  tileStyle: TileStyle;
  setTileStyle: React.Dispatch<React.SetStateAction<TileStyle>>;
}

const TileStyleContext = React.createContext<TileStyleContextValue>({
  tileStyle: "street",
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setTileStyle: () => {},
});

export function TileStyleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tileStyle, setTileStyle] = React.useState<TileStyle>("street");

  const value = React.useMemo(
    () => ({ tileStyle, setTileStyle }),
    [tileStyle],
  );

  return <TileStyleContext value={value}>{children}</TileStyleContext>;
}

export function useTileStyle() {
  return React.useContext(TileStyleContext);
}
