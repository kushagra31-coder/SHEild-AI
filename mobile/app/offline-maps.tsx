import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ProgressBarAndroid,
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  offlineMapManager,
  OfflineRegionMeta,
  getEffectiveMapConfig,
  getTotalOfflineStorageBytes,
} from "../src/services/offline-map-manager";

export default function OfflineMapsScreen() {
  const router = useRouter();
  const mapConfig = getEffectiveMapConfig();
  const [regions, setRegions] = useState<OfflineRegionMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState<{ longitude: number; latitude: number } | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<{ isCovered: boolean; regionName?: string }>({
    isCovered: false,
  });
  const [activeDownloadingId, setActiveDownloadingId] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const list = await offlineMapManager.getRegions();
      setRegions(list);

      // Check current device GPS
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (loc?.coords) {
          const coords = { longitude: loc.coords.longitude, latitude: loc.coords.latitude };
          setCurrentLocation(coords);
          const cov = await offlineMapManager.isLocationCoveredOffline(coords.longitude, coords.latitude);
          setCoverageStatus(cov);
        }
      }
    } catch (e) {
      console.warn("Failed loading offline regions:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownload = async (region: OfflineRegionMeta) => {
    setActiveDownloadingId(region.id);

    await offlineMapManager.downloadRegion(region, (updatedMeta) => {
      setRegions((prev) =>
        prev.map((r) => (r.id === updatedMeta.id ? { ...r, ...updatedMeta } : r))
      );
      if (updatedMeta.status === "READY" || updatedMeta.status === "ERROR") {
        setActiveDownloadingId(null);
        // Refresh coverage
        if (currentLocation) {
          offlineMapManager.isLocationCoveredOffline(currentLocation.longitude, currentLocation.latitude).then(setCoverageStatus);
        }
      }
    });
  };

  const handleCancel = async (regionId: string) => {
    await offlineMapManager.cancelDownload(regionId);
    setActiveDownloadingId(null);
    loadData();
  };

  const handleDelete = (region: OfflineRegionMeta) => {
    Alert.alert(
      "Delete Offline Map",
      `Delete "${region.name}" from local offline storage? Tiles will be removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await offlineMapManager.deleteRegion(region.id);
            loadData();
          },
        },
      ]
    );
  };

  const handleDownloadCurrentLocation = async () => {
    if (!currentLocation) {
      Alert.alert(
        "Location Needed",
        "Please allow GPS location access to calculate the 5km safety bounding box around your position."
      );
      return;
    }

    const customRegion = offlineMapManager.createCustomLocationRegion(
      currentLocation.longitude,
      currentLocation.latitude,
      "My Live Area (5km Bounding Box)"
    );

    // Add to regions list immediately
    setRegions((prev) => [customRegion, ...prev.filter((r) => r.id !== customRegion.id)]);
    handleDownload(customRegion);
  };

  const defaultRegion = regions.find((r) => r.isDefault);
  const totalStorageBytes = getTotalOfflineStorageBytes(regions);
  const totalStorageMB = (totalStorageBytes / (1024 * 1024)).toFixed(1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Offline Map Manager 🗺️</Text>
      </View>

      <Text style={styles.sub}>
        Store vector tile packs in MapLibre SQLite storage for citizen protection without cellular connectivity.
      </Text>

      {/* Tile Provider & Licence Card */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.cardSectionTag}>TILE PROVIDER & OFFLINE LICENCE</Text>
            <Text style={styles.cardTitle}>{mapConfig.providerName}</Text>
            <Text style={styles.cardSub}>
              {mapConfig.isProductionProvider
                ? "Licensed for mobile offline vector caching. Street-level zoom (12–15)."
                : "Fallback demo style (maxzoom 6). To enable street-level offline tiles, configure EXPO_PUBLIC_MAP_API_KEY in .env."}
            </Text>
          </View>
          <View style={mapConfig.isProductionProvider ? styles.badgeReady : styles.badgeWarning}>
            <Text style={mapConfig.isProductionProvider ? styles.badgeReadyText : styles.badgeWarningText}>
              {mapConfig.isProductionProvider ? "PRODUCTION" : "DEMO (Z0-6)"}
            </Text>
          </View>
        </View>
      </View>

      {/* Coverage Status Card */}
      <View style={styles.card}>
        <Text style={styles.cardSectionTag}>GPS OFFLINE COVERAGE STATUS</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusIcon}>{coverageStatus.isCovered ? "🟢" : "⚠️"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.statusTitle}>
              {coverageStatus.isCovered
                ? `Protected Offline: ${coverageStatus.regionName}`
                : "Beyond Downloaded Coverage"}
            </Text>
            <Text style={styles.statusDesc}>
              {coverageStatus.isCovered
                ? "Your current coordinates are fully covered by local offline vector tiles."
                : currentLocation
                ? `Current GPS: [${currentLocation.longitude.toFixed(3)}, ${currentLocation.latitude.toFixed(3)}]. Download your live area below.`
                : "Locating device coordinates..."}
            </Text>
          </View>
        </View>

        {/* Current Location 1-Tap Download */}
        <TouchableOpacity
          onPress={handleDownloadCurrentLocation}
          style={styles.actionBtnPrimary}
          activeOpacity={0.8}
        >
          <Text style={styles.actionBtnPrimaryText}>
            📥 Download Area Around My Current Position (5km)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Default Safety Region Status */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardSectionTag}>DEFAULT OFFLINE PACK</Text>
            <Text style={styles.cardTitle}>{defaultRegion?.name || "Central Safety Hub"}</Text>
            <Text style={styles.cardSub}>{defaultRegion?.description}</Text>
          </View>
          <View style={defaultRegion?.status === "READY" ? styles.badgeReady : styles.badgeNotDownloaded}>
            <Text style={defaultRegion?.status === "READY" ? styles.badgeReadyText : styles.badgeNotDownloadedText}>
              {defaultRegion?.status === "READY" ? "READY ✓" : "NOT SAVED"}
            </Text>
          </View>
        </View>

        {defaultRegion && defaultRegion.status !== "READY" && (
          <TouchableOpacity
            onPress={() => handleDownload(defaultRegion)}
            style={[styles.downloadPillBtn, { marginTop: 12 }]}
            disabled={activeDownloadingId === defaultRegion.id}
          >
            <Text style={styles.downloadPillBtnText}>
              {activeDownloadingId === defaultRegion.id ? "Downloading..." : "Download Default Region ⚡"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Storage and Revalidation */}
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricVal}>{totalStorageMB} MB</Text>
          <Text style={styles.metricLabel}>Offline Storage Used</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricVal}>
            {regions.filter((r) => r.status === "READY").length}
          </Text>
          <Text style={styles.metricLabel}>Saved Regions</Text>
        </View>
      </View>

      {/* Available & Custom Regions List */}
      <Text style={styles.sectionHeader}>Saved & Predefined Regions</Text>
      {isLoading ? (
        <ActivityIndicator size="small" color="#ec4899" style={{ marginVertical: 20 }} />
      ) : (
        regions.map((region) => {
          const isDownloading = region.status === "DOWNLOADING";
          const isReady = region.status === "READY";
          const isError = region.status === "ERROR";

          return (
            <View key={region.id} style={styles.regionCard}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.regionName}>{region.name}</Text>
                  <Text style={styles.regionDesc}>{region.description}</Text>
                </View>
                <View style={isReady ? styles.badgeReady : isError ? styles.badgeError : styles.badgePending}>
                  <Text style={isReady ? styles.badgeReadyText : isError ? styles.badgeErrorText : styles.badgePendingText}>
                    {isReady ? "SAVED ✓" : isDownloading ? `${region.progressPercentage}%` : isError ? "ERROR ⚠️" : "AVAILABLE"}
                  </Text>
                </View>
              </View>

              {/* Progress bar during download */}
              {isDownloading && (
                <View style={styles.progressContainer}>
                  <View style={[styles.progressBarFill, { width: `${Math.max(5, region.progressPercentage)}%` }]} />
                  <Text style={styles.progressText}>
                    Downloading: {region.progressPercentage}% ({region.completedTileCount} tiles • {(region.downloadedBytes / 1024).toFixed(0)} KB)
                  </Text>
                </View>
              )}

              {/* Error Message */}
              {isError && region.error && (
                <Text style={styles.errorText}>Error: {region.error}</Text>
              )}

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                {isDownloading ? (
                  <TouchableOpacity onPress={() => handleCancel(region.id)} style={styles.cancelBtn}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                ) : isReady ? (
                  <TouchableOpacity onPress={() => handleDelete(region)} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>Delete Pack 🗑️</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => handleDownload(region)}
                    style={styles.downloadBtn}
                    disabled={activeDownloadingId !== null}
                  >
                    <Text style={styles.downloadBtnText}>Download Region 📥</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}

      {/* Licensing & Attribution */}
      <View style={styles.licenseCard}>
        <Text style={styles.licenseTitle}>📜 Tile Provider & Licensing Terms</Text>
        <Text style={styles.licenseBody}>
          • Attribution: {mapConfig.attribution}{"\n"}
          • Open Database License (ODbL) © OpenStreetMap contributors.{"\n"}
          • Native vector rendering powered by MapLibre Native SQLite storage engine. Zero scraping against public OSM raster servers.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#080d1a" },
  content: { paddingHorizontal: 16, paddingTop: 50, paddingBottom: 40 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  backBtn: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  backBtnText: { color: "#38bdf8", fontWeight: "700", fontSize: 13 },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  sub: { color: "#94a3b8", fontSize: 12, marginBottom: 16, lineHeight: 18 },
  card: {
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 16,
    borderRadius: 18,
    marginBottom: 14,
  },
  cardSectionTag: { color: "#ec4899", fontSize: 10, fontWeight: "900", letterSpacing: 0.5, marginBottom: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  statusIcon: { fontSize: 22 },
  statusTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  statusDesc: { color: "#94a3b8", fontSize: 12, marginTop: 2, lineHeight: 16 },
  actionBtnPrimary: {
    backgroundColor: "#be185d",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  actionBtnPrimaryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  cardSub: { color: "#64748b", fontSize: 12, marginTop: 2 },
  badgeReady: { backgroundColor: "#064e3b", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#10b981" },
  badgeReadyText: { color: "#34d399", fontSize: 10, fontWeight: "800" },
  badgeWarning: { backgroundColor: "#78350f", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "#f59e0b" },
  badgeWarningText: { color: "#fcd34d", fontSize: 10, fontWeight: "800" },
  badgeNotDownloaded: { backgroundColor: "#334155", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeNotDownloadedText: { color: "#cbd5e1", fontSize: 10, fontWeight: "700" },
  badgePending: { backgroundColor: "#1e293b", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgePendingText: { color: "#38bdf8", fontSize: 10, fontWeight: "700" },
  badgeError: { backgroundColor: "#7f1d1d", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeErrorText: { color: "#fca5a5", fontSize: 10, fontWeight: "800" },
  downloadPillBtn: { backgroundColor: "#0284c7", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  downloadPillBtnText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  metricCard: {
    flex: 1,
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
    borderRadius: 16,
    alignItems: "center",
  },
  metricVal: { color: "#38bdf8", fontSize: 18, fontWeight: "900", marginBottom: 2 },
  metricLabel: { color: "#64748b", fontSize: 11, fontWeight: "600" },
  sectionHeader: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", marginBottom: 12 },
  regionCard: {
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  regionName: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  regionDesc: { color: "#94a3b8", fontSize: 11, marginTop: 2, lineHeight: 16 },
  progressContainer: { marginTop: 10, backgroundColor: "#090e1d", borderRadius: 8, overflow: "hidden", position: "relative", height: 20, justifyContent: "center" },
  progressBarFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#ec4899" },
  progressText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", textAlign: "center", zIndex: 1 },
  errorText: { color: "#f87171", fontSize: 11, marginTop: 6 },
  actionsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, gap: 8 },
  downloadBtn: { backgroundColor: "#0284c7", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  downloadBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  cancelBtn: { backgroundColor: "#475569", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  cancelBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  deleteBtn: { backgroundColor: "#7f1d1d", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  deleteBtnText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  licenseCard: {
    backgroundColor: "#090e1d",
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 12,
    borderRadius: 14,
    marginTop: 10,
  },
  licenseTitle: { color: "#94a3b8", fontSize: 11, fontWeight: "800", marginBottom: 4 },
  licenseBody: { color: "#64748b", fontSize: 10, lineHeight: 15 },
});
