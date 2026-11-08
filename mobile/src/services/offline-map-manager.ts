import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  OfflineManager,
  OfflinePack,
  type OfflinePackStatus,
  type LngLatBounds,
} from "@maplibre/maplibre-react-native";

export interface OfflineRegionMeta {
  id: string; // Unique ID (UUID from MapLibre or predefined ID)
  name: string;
  description: string;
  bounds: LngLatBounds; // [west, south, east, north]
  minZoom: number;
  maxZoom: number;
  status: "NOT_DOWNLOADED" | "DOWNLOADING" | "READY" | "ERROR";
  progressPercentage: number;
  downloadedBytes: number;
  completedTileCount: number;
  requiredResourceCount: number;
  downloadedAt?: string;
  error?: string;
  isDefault?: boolean;
}

export interface OfflineMapProviderConfig {
  styleUrl: string;
  providerName: string;
  isProductionProvider: boolean;
  attribution: string;
}

const STORAGE_KEY = "SHEILD_OFFLINE_MAP_REGIONS_V2";

/**
 * Evaluates the effective MapLibre style and tile provider configuration.
 * Automatically formats MapTiler / Stadia URLs when API keys are present.
 * Strictly distinguishes fallback demo tiles (maxzoom 6) from production vector tiles.
 */
export function getEffectiveMapConfig(): OfflineMapProviderConfig {
  const customUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim();
  const apiKey = process.env.EXPO_PUBLIC_MAP_API_KEY?.trim();

  let styleUrl = "https://demotiles.maplibre.org/style.json";
  let providerName = "MapLibre Demotiles (Fallback - MaxZoom 6)";
  let isProductionProvider = false;
  let attribution = "© OpenStreetMap contributors, © MapLibre";

  if (customUrl) {
    styleUrl = customUrl;
    if (apiKey && !styleUrl.includes("key=") && !styleUrl.includes("api_key=")) {
      const separator = styleUrl.includes("?") ? "&" : "?";
      styleUrl = `${styleUrl}${separator}key=${apiKey}`;
    }
  } else if (apiKey) {
    // MapTiler Dataviz Dark vector style when API key is provided
    styleUrl = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${apiKey}`;
  }

  if (styleUrl.includes("maptiler.com")) {
    providerName = "MapTiler Cloud (Offline Permitted)";
    isProductionProvider = true;
    attribution = "© MapTiler, © OpenStreetMap contributors";
  } else if (styleUrl.includes("stadiamaps.com")) {
    providerName = "Stadia Maps";
    isProductionProvider = true;
    attribution = "© Stadia Maps, © OpenMapTiles, © OpenStreetMap contributors";
  } else if (styleUrl.includes("demotiles.maplibre.org")) {
    providerName = "MapLibre Demotiles (Fallback - MaxZoom 6)";
    isProductionProvider = false;
    attribution = "© OpenStreetMap contributors, © MapLibre";
  } else {
    providerName = "Custom Vector Provider";
    isProductionProvider = true;
    attribution = "© OpenStreetMap contributors";
  }

  return { styleUrl, providerName, isProductionProvider, attribution };
}

export const DEFAULT_STYLE_URL = getEffectiveMapConfig().styleUrl;

export function isValidBoundingBox(bounds?: LngLatBounds | number[]): boolean {
  if (!Array.isArray(bounds) || bounds.length !== 4) return false;
  const [west, south, east, north] = bounds;
  if (
    typeof west !== "number" || isNaN(west) ||
    typeof south !== "number" || isNaN(south) ||
    typeof east !== "number" || isNaN(east) ||
    typeof north !== "number" || isNaN(north)
  ) {
    return false;
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) return false;
  if (south < -90 || south > 90 || north < -90 || north > 90) return false;
  if (west >= east || south >= north) return false;
  return true;
}

export function getTotalOfflineStorageBytes(regions: OfflineRegionMeta[]): number {
  return regions
    .filter((r) => r.status === "READY")
    .reduce((acc, r) => acc + (r.downloadedBytes || 0), 0);
}

// Predefined regions for safety perimeters
export const PREDEFINED_REGIONS: Omit<
  OfflineRegionMeta,
  "status" | "progressPercentage" | "downloadedBytes" | "completedTileCount" | "requiredResourceCount"
>[] = [
  {
    id: "delhi-central-hub",
    name: "Delhi Central Transit & Safety Hub",
    description: "Connaught Place, Transit Hubs, and Central Corridors (~1.4 MB)",
    bounds: [77.185, 28.585, 77.245, 28.645], // [west, south, east, north]
    minZoom: 12,
    maxZoom: 15,
    isDefault: true,
  },
  {
    id: "mumbai-downtown",
    name: "Mumbai Downtown Transit Corridor",
    description: "Fort, Colaba, Marine Drive Transit Network (~1.8 MB)",
    bounds: [72.810, 18.910, 72.850, 18.960],
    minZoom: 12,
    maxZoom: 15,
    isDefault: false,
  },
  {
    id: "bengaluru-corridor",
    name: "Bengaluru South Safety Zone",
    description: "Koramangala, HSR Layout, Silk Board Hub (~1.6 MB)",
    bounds: [77.590, 12.910, 77.650, 12.960],
    minZoom: 12,
    maxZoom: 15,
    isDefault: false,
  },
];

type ProgressCallback = (status: OfflineRegionMeta) => void;

class OfflineMapManager {
  private activeListeners: Map<string, ProgressCallback> = new Map();
  private inFlightPacks: Map<string, OfflinePack> = new Map();

  /**
   * Initializes and reconciles local storage metadata with native MapLibre offline packs.
   */
  public async getRegions(): Promise<OfflineRegionMeta[]> {
    const stored = await this.readMetadata();
    const result: Map<string, OfflineRegionMeta> = new Map();

    // Seed predefined regions
    for (const p of PREDEFINED_REGIONS) {
      result.set(p.id, {
        ...p,
        status: "NOT_DOWNLOADED",
        progressPercentage: 0,
        downloadedBytes: 0,
        completedTileCount: 0,
        requiredResourceCount: 0,
      });
    }

    // Merge stored metadata
    for (const s of stored) {
      const existing = result.get(s.id);
      if (existing) {
        result.set(s.id, { ...existing, ...s });
      } else {
        result.set(s.id, s);
      }
    }

    // Reconcile with native MapLibre database if running on native
    if (Platform.OS !== "web") {
      try {
        const packs = await OfflineManager.getPacks();
        const matchedRegionIds = new Set<string>();

        for (const pack of packs) {
          const packId = pack.id;
          const metaName = (pack.metadata?.name as string) || (pack.metadata?.id as string) || packId;
          const status: OfflinePackStatus = await pack.status();

          // Find matching region
          let matched: OfflineRegionMeta | undefined = result.get(metaName) || result.get(packId);
          if (!matched) {
            for (const r of result.values()) {
              if (r.id === packId || r.name === metaName) {
                matched = r;
                break;
              }
            }
          }

          if (matched) {
            matchedRegionIds.add(matched.id);
            if (status.state === "complete") {
              matched.status = "READY";
              matched.progressPercentage = 100;
            } else if (status.state === "active") {
              matched.status = "DOWNLOADING";
              matched.progressPercentage = Math.round(status.percentage || 0);
            } else {
              // Pack was paused or interrupted
              matched.status = "NOT_DOWNLOADED";
              matched.progressPercentage = 0;
            }
            matched.downloadedBytes = status.completedResourceSize || 0;
            matched.completedTileCount = status.completedTileCount || status.completedResourceCount || 0;
            matched.requiredResourceCount = status.requiredResourceCount || 0;
          }
        }

        // Strict pack reconciliation:
        // Ensure UI does not report a region as downloaded when its actual offline pack is missing or invalid.
        for (const r of result.values()) {
          if (r.status === "READY" && !matchedRegionIds.has(r.id)) {
            r.status = "NOT_DOWNLOADED";
            r.progressPercentage = 0;
            r.downloadedBytes = 0;
            r.completedTileCount = 0;
            r.requiredResourceCount = 0;
          }
        }
      } catch (err) {
        console.warn("[OfflineMapManager] Error querying native packs:", err);
      }
    }

    const finalArray = Array.from(result.values());
    await this.writeMetadata(finalArray);
    return finalArray;
  }

  /**
   * Generates a dynamic 5km bounding box around the user's current GPS location.
   */
  public createCustomLocationRegion(
    longitude: number,
    latitude: number,
    name: string = "Current Location Area (5km)"
  ): OfflineRegionMeta {
    const delta = 0.035; // ~3.8 to 4.2 km in latitude/longitude
    const bounds: LngLatBounds = [
      longitude - delta,
      latitude - delta,
      longitude + delta,
      latitude + delta,
    ];

    const id = `custom-loc-${Math.round(longitude * 1000)}-${Math.round(latitude * 1000)}`;

    return {
      id,
      name,
      description: `Surrounding area of [${longitude.toFixed(3)}, ${latitude.toFixed(3)}]`,
      bounds,
      minZoom: 12,
      maxZoom: 15,
      status: "NOT_DOWNLOADED",
      progressPercentage: 0,
      downloadedBytes: 0,
      completedTileCount: 0,
      requiredResourceCount: 0,
      isDefault: false,
    };
  }

  /**
   * Downloads an offline pack using MapLibre's native OfflineManager.
   */
  public async downloadRegion(
    region: OfflineRegionMeta,
    onProgress?: ProgressCallback
  ): Promise<OfflineRegionMeta> {
    // 1. Validate bounding box coordinates
    if (!isValidBoundingBox(region.bounds)) {
      const errorMeta: OfflineRegionMeta = {
        ...region,
        status: "ERROR",
        error: "Invalid bounding box coordinates. Expected [west, south, east, north] with west < east and south < north.",
      };
      await this.updateSingleMeta(errorMeta);
      if (onProgress) onProgress(errorMeta);
      return errorMeta;
    }

    // 2. Prevent duplicate downloads of the same pack in flight
    if (this.inFlightPacks.has(region.id) || region.status === "DOWNLOADING") {
      console.warn(`[OfflineMapManager] Download already in progress for region ${region.id}`);
      return region;
    }

    const updatedRegion: OfflineRegionMeta = {
      ...region,
      status: "DOWNLOADING",
      progressPercentage: 1,
      error: undefined,
    };
    await this.updateSingleMeta(updatedRegion);

    if (onProgress) {
      this.activeListeners.set(region.id, onProgress);
      onProgress(updatedRegion);
    }

    if (Platform.OS === "web") {
      // Simulated web completion for browser parity
      updatedRegion.status = "READY";
      updatedRegion.progressPercentage = 100;
      updatedRegion.downloadedBytes = 1450000;
      updatedRegion.completedTileCount = 142;
      updatedRegion.downloadedAt = new Date().toISOString();
      await this.updateSingleMeta(updatedRegion);
      if (onProgress) onProgress(updatedRegion);
      return updatedRegion;
    }

    try {
      const progressListener = (pack: OfflinePack, status: OfflinePackStatus) => {
        const percentage = Math.round(status.percentage || 0);
        const currentMeta: OfflineRegionMeta = {
          ...region,
          status: status.state === "complete" ? "READY" : "DOWNLOADING",
          progressPercentage: percentage,
          downloadedBytes: status.completedResourceSize || 0,
          completedTileCount: status.completedTileCount || status.completedResourceCount || 0,
          requiredResourceCount: status.requiredResourceCount || 0,
          downloadedAt: status.state === "complete" ? new Date().toISOString() : undefined,
        };

        if (status.state === "complete") {
          this.inFlightPacks.delete(region.id);
          this.activeListeners.delete(region.id);
        }

        this.updateSingleMeta(currentMeta);
        const cb = this.activeListeners.get(region.id);
        if (cb) cb(currentMeta);
      };

      const errorListener = (pack: OfflinePack, error: { id: string; message: string }) => {
        console.error("[OfflineMapManager] Native download error:", error);
        const failedMeta: OfflineRegionMeta = {
          ...region,
          status: "ERROR",
          error: error.message || "Failed downloading map region",
        };
        this.inFlightPacks.delete(region.id);
        this.activeListeners.delete(region.id);
        this.updateSingleMeta(failedMeta);
        const cb = this.activeListeners.get(region.id);
        if (cb) cb(failedMeta);
      };

      try {
        OfflineManager.setTileCountLimit(15000);
        OfflineManager.setProgressEventThrottle(250);
      } catch (e) {
        // safe guard
      }

      const config = getEffectiveMapConfig();
      // Demotiles only hosts tiles up to zoom 6. If downloading against demotiles,
      // clamp maxZoom to 6 to prevent 404 tile download failures.
      const effectiveMinZoom = config.isProductionProvider ? region.minZoom : Math.min(region.minZoom, 0);
      const effectiveMaxZoom = config.isProductionProvider ? region.maxZoom : Math.min(region.maxZoom, 6);

      const pack = await OfflineManager.createPack(
        {
          mapStyle: config.styleUrl,
          bounds: region.bounds,
          minZoom: effectiveMinZoom,
          maxZoom: effectiveMaxZoom,
          metadata: {
            id: region.id,
            name: region.name,
            bounds: region.bounds,
            provider: config.providerName,
          },
        },
        progressListener,
        errorListener
      );

      this.inFlightPacks.set(region.id, pack);
      return updatedRegion;
    } catch (err: any) {
      console.error("[OfflineMapManager] Failed to create pack:", err);
      const failedMeta: OfflineRegionMeta = {
        ...region,
        status: "ERROR",
        error: err?.message || "Could not initialize offline download",
      };
      await this.updateSingleMeta(failedMeta);
      if (onProgress) onProgress(failedMeta);
      return failedMeta;
    }
  }

  /**
   * Cancels an active download.
   */
  public async cancelDownload(regionId: string): Promise<void> {
    const pack = this.inFlightPacks.get(regionId);
    if (pack) {
      try {
        await pack.pause();
        await OfflineManager.deletePack(pack.id);
      } catch (e) {
        console.warn("Could not cancel pack:", e);
      }
      this.inFlightPacks.delete(regionId);
    }
    this.activeListeners.delete(regionId);

    const regions = await this.getRegions();
    const target = regions.find((r) => r.id === regionId);
    if (target) {
      target.status = "NOT_DOWNLOADED";
      target.progressPercentage = 0;
      target.downloadedBytes = 0;
      target.completedTileCount = 0;
      target.requiredResourceCount = 0;
      target.error = undefined;
      await this.writeMetadata(regions);
    }
  }

  /**
   * Deletes an offline region from disk storage.
   */
  public async deleteRegion(regionId: string): Promise<void> {
    await this.cancelDownload(regionId);

    if (Platform.OS !== "web") {
      try {
        const packs = await OfflineManager.getPacks();
        for (const p of packs) {
          if (p.id === regionId || (p.metadata?.id as string) === regionId || (p.metadata?.name as string) === regionId) {
            await OfflineManager.deletePack(p.id);
          }
        }
      } catch (err) {
        console.warn("[OfflineMapManager] Delete pack error:", err);
      }
    }

    const regions = await this.readMetadata();
    const filtered = regions.filter((r) => r.id !== regionId);
    await this.writeMetadata(filtered);
  }

  /**
   * Checks whether a given [longitude, latitude] point is inside any downloaded offline pack.
   */
  public async isLocationCoveredOffline(longitude: number, latitude: number): Promise<{
    isCovered: boolean;
    regionName?: string;
  }> {
    const regions = await this.getRegions();
    const readyRegions = regions.filter((r) => r.status === "READY");

    for (const r of readyRegions) {
      const [west, south, east, north] = r.bounds;
      if (
        longitude >= west &&
        longitude <= east &&
        latitude >= south &&
        latitude <= north
      ) {
        return { isCovered: true, regionName: r.name };
      }
    }

    return { isCovered: false };
  }

  /**
   * Checks whether the default offline region is downloaded.
   */
  public async isDefaultRegionReady(): Promise<boolean> {
    const regions = await this.getRegions();
    const def = regions.find((r) => r.isDefault);
    return def?.status === "READY";
  }

  private async readMetadata(): Promise<OfflineRegionMeta[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("Could not read offline map metadata");
    }
    return [];
  }

  private async writeMetadata(list: OfflineRegionMeta[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Could not save offline map metadata");
    }
  }

  private async updateSingleMeta(item: OfflineRegionMeta): Promise<void> {
    const stored = await this.readMetadata();
    const idx = stored.findIndex((r) => r.id === item.id);
    if (idx >= 0) {
      stored[idx] = item;
    } else {
      stored.push(item);
    }
    await this.writeMetadata(stored);
  }
}

export const offlineMapManager = new OfflineMapManager();
