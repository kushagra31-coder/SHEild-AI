import React, { useRef, useMemo, useEffect, useState } from "react";
import { View, StyleSheet, Platform, Text, TouchableOpacity } from "react-native";
import { CrowdZone, SafetyHazardReport } from "../services/safety-radar";
import { getEffectiveMapConfig, offlineMapManager } from "../services/offline-map-manager";

import {
  Map,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
} from "@maplibre/maplibre-react-native";

interface SafetyMapProps {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number;
  crowdZones?: CrowdZone[];
  hazards?: SafetyHazardReport[];
  showRoute?: boolean;
  routeType?: "SAFEST" | "FASTEST";
  isSosActive?: boolean;
  height?: number;
  onOpenMapManager?: () => void;
}

export const SafetyMap: React.FC<SafetyMapProps> = ({
  latitude,
  longitude,
  accuracy = 12,
  crowdZones = [],
  hazards = [],
  showRoute = false,
  routeType = "SAFEST",
  isSosActive = false,
  height = 280,
  onOpenMapManager,
}) => {
  const mapConfig = useMemo(() => getEffectiveMapConfig(), []);
  const cameraRef = useRef<any>(null);
  const [offlineStatus, setOfflineStatus] = useState<{ isCovered: boolean; regionName?: string }>({
    isCovered: false,
  });

  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  // GeoJSON standard: [longitude, latitude]
  const userLngLat: [number, number] = useMemo(() => {
    if (hasCoords) return [longitude as number, latitude as number];
    return [77.209, 28.6139]; // default visual center if locating
  }, [latitude, longitude, hasCoords]);

  // Check offline coverage whenever coordinates change
  useEffect(() => {
    let isMounted = true;
    if (hasCoords) {
      offlineMapManager.isLocationCoveredOffline(longitude as number, latitude as number).then((res) => {
        if (isMounted) setOfflineStatus(res);
      });
    }
    return () => {
      isMounted = false;
    };
  }, [latitude, longitude, hasCoords]);

  // GeoJSON Features for Crowd Zones (density circles)
  const crowdZonesGeoJSON = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: crowdZones.map((z) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [z.longitude, z.latitude], // [lng, lat]
        },
        properties: {
          id: z.id,
          name: z.name,
          color: z.densityLevel === "HIGH" ? "#10b981" : z.densityLevel === "MODERATE" ? "#f59e0b" : "#ef4444",
          densityLabel: z.densityLabel,
          score: z.score,
        },
      })),
    };
  }, [crowdZones]);

  // GeoJSON Route Line (Safest vs Fastest)
  const routeGeoJSON = useMemo(() => {
    const [lon, lat] = userLngLat;
    const isSafe = routeType === "SAFEST";

    const coordinates = isSafe
      ? [
          [lon, lat],
          [lon + 0.002, lat + 0.003],
          [lon + 0.005, lat + 0.007],
          [lon + 0.008, lat + 0.011],
        ]
      : [
          [lon, lat],
          [lon + 0.001, lat + 0.004],
          [lon + 0.003, lat + 0.008],
          [lon + 0.008, lat + 0.011],
        ];

    return {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates,
          },
          properties: {
            color: isSafe ? "#34d399" : "#f59e0b",
          },
        },
      ],
    };
  }, [userLngLat, routeType]);

  // Render Web platform fallback
  if (Platform.OS === "web" || !Map) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.webFallbackContainer}>
          <Text style={styles.webFallbackTitle}>🗺️ SHEild AI Vector Safety Radar</Text>
          <Text style={styles.webFallbackSub}>
            Native MapLibre GL engine active on Android & iOS builds.
          </Text>
          <View style={styles.webCoordsBadge}>
            <Text style={styles.webCoordsText}>
              {hasCoords
                ? `📍 GPS: ${latitude?.toFixed(4)}, ${longitude?.toFixed(4)} (±${accuracy}m)`
                : "📍 GPS: Locating Device..."}
            </Text>
          </View>
          {offlineStatus.isCovered ? (
            <Text style={styles.webOfflineNotice}>🟢 Offline Tile Pack Active: {offlineStatus.regionName}</Text>
          ) : (
            <Text style={styles.webOfflineNotice}>🟡 Map Ready for Local Download ({mapConfig.providerName})</Text>
          )}
        </View>

        <View style={styles.badgeOverlay}>
          <Text style={styles.badgeText}>
            {isSosActive ? "🚨 SOS ACTIVE" : offlineStatus.isCovered ? "🟢 OFFLINE READY" : "🟢 MAPLIBRE NATIVE"}
          </Text>
        </View>

        <View style={styles.attributionBadge}>
          <Text style={styles.attributionText}>{mapConfig.attribution}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <Map
        style={styles.map}
        mapStyle={mapConfig.styleUrl}
        logo={false}
        attribution={false}
        compass={true}
        compassPosition={{ top: 8, right: 8 }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: userLngLat,
            zoom: 14,
          }}
          center={userLngLat}
          zoom={14}
        />

        {/* Crowd Density Footfall Zones */}
        <GeoJSONSource id="crowd-zones-source" data={crowdZonesGeoJSON}>
          <Layer
            id="crowd-zones-layer"
            type="circle"
            style={{
              circleRadius: 28,
              circleColor: ["get", "color"],
              circleOpacity: 0.22,
              circleStrokeColor: ["get", "color"],
              circleStrokeWidth: 1.5,
            }}
          />
        </GeoJSONSource>

        {/* Safe Journey Navigation Polyline */}
        {showRoute && (
          <GeoJSONSource id="route-corridor-source" data={routeGeoJSON}>
            <Layer
              id="route-corridor-layer"
              type="line"
              style={{
                lineColor: ["get", "color"],
                lineWidth: 4.5,
                lineOpacity: 0.85,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Community Hazard Markers */}
        {hazards.map((h) => {
          const emoji =
            h.type === "POLICE_BOOTH"
              ? "👮"
              : h.type === "SAFE_HAVEN"
              ? "🏥"
              : h.type === "DARK_STREET"
              ? "💡"
              : "🚨";
          return (
            <Marker key={h.id} id={h.id} lngLat={[h.longitude, h.latitude]}>
              <View style={styles.hazardMarker}>
                <Text style={styles.hazardEmoji}>{emoji}</Text>
              </View>
            </Marker>
          );
        })}

        {/* Live User Pulsing Location Marker */}
        {hasCoords && (
          <Marker id="user-location-pulse" lngLat={userLngLat}>
            <View style={[styles.pulsePin, isSosActive && styles.pulsePinSos]}>
              <View style={styles.innerDot} />
            </View>
          </Marker>
        )}
      </Map>

      {/* Dynamic Status Banner Overlay */}
      <View style={styles.badgeOverlay}>
        <TouchableOpacity activeOpacity={0.8} onPress={onOpenMapManager}>
          <Text style={[styles.badgeText, isSosActive && styles.badgeTextSos]}>
            {isSosActive
              ? "🚨 SOS EMERGENCY ACTIVE"
              : offlineStatus.isCovered
              ? `🟢 OFFLINE: ${offlineStatus.regionName}`
              : "🗺️ OFFLINE MAP MANAGER ⚙️"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Legal Attribution Notice (Required by OSM / ODbL & MapLibre) */}
      <View style={styles.attributionBadge}>
        <Text style={styles.attributionText}>{mapConfig.attribution}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#1e3a8a",
    backgroundColor: "#080d1a",
    position: "relative",
  },
  map: {
    flex: 1,
  },
  pulsePin: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(236, 72, 153, 0.4)",
    borderWidth: 2,
    borderColor: "#ec4899",
    alignItems: "center",
    justifyContent: "center",
  },
  pulsePinSos: {
    backgroundColor: "rgba(239, 68, 68, 0.5)",
    borderColor: "#ef4444",
  },
  innerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FFFFFF",
  },
  hazardMarker: {
    backgroundColor: "#0f172a",
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
  },
  hazardEmoji: {
    fontSize: 14,
  },
  badgeOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(13, 21, 39, 0.92)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#38bdf8",
    zIndex: 10,
  },
  badgeText: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  badgeTextSos: {
    color: "#ef4444",
  },
  attributionBadge: {
    position: "absolute",
    bottom: 6,
    right: 8,
    backgroundColor: "rgba(8, 13, 26, 0.85)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    zIndex: 10,
  },
  attributionText: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "600",
  },
  webFallbackContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#091124",
  },
  webFallbackTitle: {
    color: "#ec4899",
    fontWeight: "800",
    fontSize: 15,
    marginBottom: 6,
  },
  webFallbackSub: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 10,
  },
  webCoordsBadge: {
    backgroundColor: "#0d1b38",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1e3a8a",
    marginBottom: 8,
  },
  webCoordsText: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "700",
  },
  webOfflineNotice: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "700",
  },
});
