import React, { useRef, useMemo } from "react";
import { View, StyleSheet, Platform, Text, TouchableOpacity } from "react-native";
import { WebView } from "react-native-webview";
import { CrowdZone, SafetyHazardReport } from "../services/safety-radar";

interface SafetyMapProps {
  latitude: number;
  longitude: number;
  accuracy?: number;
  crowdZones?: CrowdZone[];
  hazards?: SafetyHazardReport[];
  showRoute?: boolean;
  routeType?: "SAFEST" | "FASTEST";
  isSosActive?: boolean;
  height?: number;
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
  height = 280
}) => {
  const webViewRef = useRef<WebView>(null);

  // Generate Leaflet HTML
  const mapHtml = useMemo(() => {
    const lat = latitude || 28.6139;
    const lon = longitude || 77.2090;

    const safeRouteCoords = [
      [lat, lon],
      [lat + 0.003, lon + 0.002],
      [lat + 0.007, lon + 0.005],
      [lat + 0.011, lon + 0.008]
    ];

    const fastRouteCoords = [
      [lat, lon],
      [lat + 0.004, lon + 0.001],
      [lat + 0.008, lon + 0.003],
      [lat + 0.011, lon + 0.008]
    ];

    const serializedCrowdZones = JSON.stringify(crowdZones);
    const serializedHazards = JSON.stringify(hazards);
    const serializedSafeRoute = JSON.stringify(safeRouteCoords);
    const serializedFastRoute = JSON.stringify(fastRouteCoords);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #080d1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .leaflet-container { background: #080d1a; }
    .pulse-pin {
      width: 24px;
      height: 24px;
      background: ${isSosActive ? "#ef4444" : "#ec4899"};
      border: 3px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 16px ${isSosActive ? "rgba(239,68,68,0.9)" : "rgba(236,72,153,0.8)"};
      animation: pulse-ring 1.8s infinite;
    }
    @keyframes pulse-ring {
      0% { box-shadow: 0 0 0 0 ${isSosActive ? "rgba(239,68,68,0.8)" : "rgba(236,72,153,0.8)"}; }
      70% { box-shadow: 0 0 0 24px rgba(236,72,153,0); }
      100% { box-shadow: 0 0 0 0 rgba(236,72,153,0); }
    }
    .custom-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      border-radius: 50%;
      background: #0f172a;
      border: 2px solid #38bdf8;
      box-shadow: 0 2px 8px rgba(0,0,0,0.6);
    }
    .leaflet-popup-content-wrapper {
      background: #0d1527;
      color: #f8fafc;
      border: 1px solid #1e3a8a;
      border-radius: 12px;
      font-size: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.8);
    }
    .leaflet-popup-tip {
      background: #0d1527;
    }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .badge-safe { background: #064e3b; color: #34d399; }
    .badge-high { background: #7f1d1d; color: #f87171; }
    .badge-mod { background: #78350f; color: #fbbf24; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var userLat = ${lat};
    var userLon = ${lon};
    var map = L.map('map', {
      center: [userLat, userLon],
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    // Dark Carto tiles for cyberpunk/sleek night aesthetics
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);

    // Accuracy Circle
    L.circle([userLat, userLon], {
      radius: ${accuracy},
      color: '${isSosActive ? "#ef4444" : "#ec4899"}',
      fillColor: '${isSosActive ? "#ef4444" : "#ec4899"}',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);

    // User Pulse Marker
    var pulseIcon = L.divIcon({
      className: '',
      html: '<div class="pulse-pin"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker([userLat, userLon], { icon: pulseIcon })
      .addTo(map)
      .bindPopup('<b>📍 Live Location</b><br/>±${accuracy}m GPS Accuracy' + (${isSosActive} ? '<br/><span class="badge badge-high">🚨 SOS Active</span>' : '<br/><span class="badge badge-safe">Shield Active</span>'));

    // Render Crowd Zones (Safetipin Crowd Radar)
    var crowdZones = ${serializedCrowdZones};
    crowdZones.forEach(function(zone) {
      var color = zone.densityLevel === 'HIGH' ? '#10b981' : (zone.densityLevel === 'MODERATE' ? '#f59e0b' : '#ef4444');
      var circle = L.circle([zone.latitude, zone.longitude], {
        radius: zone.radiusMeters,
        color: color,
        fillColor: color,
        fillOpacity: 0.18,
        weight: 1.5,
        dashArray: '4, 4'
      }).addTo(map);

      circle.bindPopup(
        '<b>👥 ' + zone.name + '</b><br/>' +
        zone.densityLabel + '<br/>' +
        'Safetipin Score: <b>' + zone.score + '/10</b><br/>' +
        '<span class="badge ' + (zone.score >= 8 ? 'badge-safe' : (zone.score >= 6 ? 'badge-mod' : 'badge-high')) + '">' + zone.densityLevel + ' FOOTFALL</span>'
      );
    });

    // Render Hazards & Safe Havens
    var hazards = ${serializedHazards};
    hazards.forEach(function(h) {
      var iconEmoji = h.type === 'POLICE_BOOTH' ? '👮' : (h.type === 'SAFE_HAVEN' ? '🏥' : (h.type === 'DARK_STREET' ? '💡' : '🚨'));
      var icon = L.divIcon({
        className: 'custom-icon',
        html: '<span>' + iconEmoji + '</span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      var badgeClass = h.severity === 'SAFE' ? 'badge-safe' : (h.severity === 'HIGH' ? 'badge-high' : 'badge-mod');
      L.marker([h.latitude, h.longitude], { icon: icon })
        .addTo(map)
        .bindPopup(
          '<b>' + iconEmoji + ' ' + h.title + '</b><br/>' +
          h.description + '<br/>' +
          '<span class="badge ' + badgeClass + '">' + h.severity + '</span> • ' + h.verifiedCount + ' community reports'
        );
    });

    // Render Safe vs Fast Route if requested
    if (${showRoute}) {
      var isSafe = '${routeType}' === 'SAFEST';
      var coords = isSafe ? ${serializedSafeRoute} : ${serializedFastRoute};
      var routeColor = isSafe ? '#34d399' : '#f59e0b';

      var routeLine = L.polyline(coords, {
        color: routeColor,
        weight: 4,
        opacity: 0.85,
        dashArray: isSafe ? null : '6, 8'
      }).addTo(map);

      // Destination Flag Marker
      var dest = coords[coords.length - 1];
      var destIcon = L.divIcon({
        className: 'custom-icon',
        html: '<span>🏁</span>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker(dest, { icon: destIcon }).addTo(map).bindPopup('<b>Destination</b><br/>' + (isSafe ? 'Safest Lit Corridor' : 'Shortest Path'));

      map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
    }
  </script>
</body>
</html>
    `;
  }, [latitude, longitude, accuracy, crowdZones, hazards, showRoute, routeType, isSosActive]);

  // For Web platform fallback
  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, { height }]}>
        <iframe
          srcDoc={mapHtml}
          style={{ width: "100%", height: "100%", border: "none", borderRadius: 18 }}
          title="Live Safety Radar Map"
        />
        <View style={styles.webTag}>
          <Text style={styles.webTagText}>🟢 Live OpenStreetMap & Crowd Radar</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: mapHtml }}
        style={styles.webView}
        scrollEnabled={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
      />
      <View style={styles.badgeOverlay}>
        <Text style={styles.badgeText}>
          {isSosActive ? "🚨 SOS TRACKING ACTIVE" : "🟢 SAFETIPIN & CROWD RADAR"}
        </Text>
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
    position: "relative"
  },
  webView: {
    flex: 1,
    backgroundColor: "#080d1a"
  },
  badgeOverlay: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(13, 21, 39, 0.9)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#38bdf8"
  },
  badgeText: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  webTag: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(13, 21, 39, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6
  },
  webTagText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700"
  }
});
