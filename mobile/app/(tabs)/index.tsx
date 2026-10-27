import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  Linking,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  Animated
} from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { Audio } from "expo-av";
import { createIncidentAPI, fetchIncidentAPI, resolveIncidentAPI, sendLocationAPI, IncidentResponse } from "../../src/services/api";
import { offlineOutbox } from "../../src/services/offline-outbox";
import { shakeDetector } from "../../src/services/shake-detector";
import { useAuth } from "../../src/context/AuthContext";
import { SafetyMap } from "../../src/components/SafetyMap";
import { EvidenceRecorderModal } from "../../src/components/EvidenceRecorderModal";
import { LiveShareModal } from "../../src/components/LiveShareModal";
import { ReportHazardModal } from "../../src/components/ReportHazardModal";
import {
  safetyRadarService,
  AreaSafetyScore,
  CrowdZone,
  SafetyHazardReport,
  DEFAULT_CROWD_ZONES
} from "../../src/services/safety-radar";

export default function HomeScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const userDisplayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";
  const [location, setLocation] = useState<any>({ latitude: 28.6139, longitude: 77.2090, accuracy: 12 });
  const [activeIncident, setActiveIncident] = useState<IncidentResponse | null>(null);
  const activeIncidentRef = useRef<IncidentResponse | null>(null);

  // Safetipin & bSafe Modals & Data
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [showLiveShareModal, setShowLiveShareModal] = useState(false);
  const [showReportHazardModal, setShowReportHazardModal] = useState(false);
  const [crowdZones, setCrowdZones] = useState<CrowdZone[]>(DEFAULT_CROWD_ZONES);
  const [hazards, setHazards] = useState<SafetyHazardReport[]>([]);
  const [safetyScore, setSafetyScore] = useState<AreaSafetyScore | null>(null);

  // Developer Failure State Simulators
  const [noInternet, setNoInternet] = useState(false);
  const [gpsActive, setGpsActive] = useState(true);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);

  // Siren state
  const [sirenPlaying, setSirenPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Hold SOS animation & countdown state
  const [holding, setHolding] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const countdownTimerRef = useRef<any>(null);
  const holdTimerRef = useRef<any>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (gpsActive) {
      requestLocation();
    }
    setupAccelerometer();

    // Initialize & load persistent offline outbox
    const initOutbox = async () => {
      const pending = await offlineOutbox.getPending();
      setPendingOutboxCount(pending.length);
    };
    initOutbox();

    // Initialize Safetipin community hazards & area safety score
    const initRadar = async () => {
      const hz = await safetyRadarService.getCommunityHazards();
      setHazards(hz);
      const score = safetyRadarService.calculateAreaSafetyScore(location?.latitude || 28.6139, location?.longitude || 77.2090);
      setSafetyScore(score);
    };
    initRadar();

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Sync outbox whenever connectivity is restored (noInternet toggled off)
  useEffect(() => {
    const handleReconnectionSync = async () => {
      if (!noInternet) {
        const { synced } = await offlineOutbox.sync();
        if (synced && synced.length > 0) {
          setActiveIncident(synced[0]);
        }
      }
      const pending = await offlineOutbox.getPending();
      setPendingOutboxCount(pending.length);
    };
    handleReconnectionSync();
  }, [noInternet]);

  // Poll active incident status from backend
  useEffect(() => {
    let interval: any;
    if (activeIncident && activeIncident.status !== "resolved") {
      interval = setInterval(async () => {
        if (!noInternet) {
          const updated = await fetchIncidentAPI(activeIncident.id);
          if (updated) {
            setActiveIncident(updated);
          }
          if (gpsActive && location) {
            await sendLocationAPI(activeIncident.id, {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy_m: location.accuracy || 12
            });
          }
        }
        const pending = await offlineOutbox.getPending();
        setPendingOutboxCount(pending.length);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeIncident, noInternet, gpsActive, location]);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });
        setLocation(loc.coords);
      }
    } catch (e) {
      console.log("Location fetch default to fallback coordinates");
    }
  };

  const setupAccelerometer = async () => {
    await shakeDetector.start({
      threshold: 3.0,
      requiredPeaks: 2,
      windowMs: 1500,
      cooldownMs: 5000,
      onShakeDetected: () => {
        // Use ref to avoid stale closure capturing initial null value
        if (!activeIncidentRef.current) {
          startCountdown("shake");
        }
      }
    });
  };

  const toggleSiren = async () => {
    try {
      if (sirenPlaying) {
        if (soundRef.current) {
          await soundRef.current.stopAsync();
        }
        setSirenPlaying(false);
      } else {
        const { sound } = await Audio.Sound.createAsync(
          require("../../assets/siren.wav")
        );
        soundRef.current = sound;
        await sound.setIsLoopingAsync(true);
        await sound.playAsync();
        setSirenPlaying(true);
      }
    } catch (e) {
      Alert.alert("Siren", "Alert Siren Audio Playing...");
    }
  };

  const startHold = () => {
    setHolding(true);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: false
    }).start();

    holdTimerRef.current = setTimeout(() => {
      setHolding(false);
      progressAnim.setValue(0);
      startCountdown("manual");
    }, 1500);
  };

  const cancelHold = () => {
    if (!holding) return;
    setHolding(false);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false
    }).start();
  };

  const startCountdown = (triggerType: "manual" | "shake" | "voice" = "manual") => {
    setCountdownSeconds(3);
    setShowCountdown(true);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

    countdownTimerRef.current = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          setShowCountdown(false);
          fireSOSAlert(triggerType);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const cancelCountdownModal = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setShowCountdown(false);
  };

  const fireSOSAlert = async (triggerType: "manual" | "shake" | "voice" = "manual") => {
    const clientEventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    if (!sirenPlaying) {
      toggleSiren();
    }

    const payload = {
      client_event_id: clientEventId,
      trigger: triggerType,
      occurred_at: new Date().toISOString(),
      location: gpsActive && location ? {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy_m: location.accuracy || 12,
        captured_at: new Date().toISOString()
      } : undefined,
      share_location: true
    };

    if (noInternet) {
      offlineOutbox.enqueue(payload);
      const offlineIncident = {
        id: clientEventId,
        owner_id: "user-123",
        client_event_id: clientEventId,
        trigger: triggerType,
        status: "draft_local" as const,
        alert_status: "queued" as const,
        started_at: new Date().toISOString()
      };
      setActiveIncident(offlineIncident);
      activeIncidentRef.current = offlineIncident;
      return;
    }

    const res = await createIncidentAPI(payload);
    if (res) {
      setActiveIncident(res);
      activeIncidentRef.current = res;
    } else {
      offlineOutbox.enqueue(payload);
      const localIncident = {
        id: clientEventId,
        owner_id: "user-123",
        client_event_id: clientEventId,
        trigger: triggerType,
        status: "draft_local" as const,
        alert_status: "queued" as const,
        started_at: new Date().toISOString()
      };
      setActiveIncident(localIncident);
      activeIncidentRef.current = localIncident;
    }
  };

  const handleResolveIncident = async () => {
    if (activeIncident && activeIncident.id) {
      await resolveIncidentAPI(activeIncident.id);
      setActiveIncident(null);
      activeIncidentRef.current = null;
      if (sirenPlaying && soundRef.current) {
        soundRef.current.stopAsync();
        setSirenPlaying(false);
      }
    }
  };

  const fillWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"]
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Brand Header */}
      <View style={styles.headerRow}>
        <View style={styles.brandContainer}>
          <Text style={styles.shieldIcon}>🛡️</Text>
          <Text style={styles.brandTitle}>SHEild AI 2.0</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <TouchableOpacity onPress={() => router.push("/guardians" as any)} style={styles.guardiansLink}>
            <Text style={styles.guardiansLinkText}>👥 Guardians</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Alert.alert("Sign Out", "Are you sure you want to sign out?", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign Out", style: "destructive", onPress: () => signOut() },
              ]);
            }}
            style={styles.signOutHeaderBtn}
          >
            <Text style={styles.signOutHeaderBtnText}>Sign Out 🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.greetingTitle}>Hello, {userDisplayName} 👋</Text>

      {/* Developer Failure State Simulators Card */}
      <View style={styles.simulatorCard}>
        <Text style={styles.simulatorHeader}>FAILURE STATE SIMULATORS (FOR DEVELOPERS)</Text>
        <View style={styles.simulatorRow}>
          <View style={styles.toggleGroup}>
            <Text style={styles.redDot}>🔴</Text>
            <Text style={styles.toggleLabel}>No Internet (Offline)</Text>
            <Switch
              value={noInternet}
              onValueChange={setNoInternet}
              trackColor={{ false: "#374151", true: "#ef4444" }}
              thumbColor={noInternet ? "#fef2f2" : "#9ca3af"}
            />
          </View>

          <View style={styles.toggleGroup}>
            <Text style={styles.greenDot}>🟢</Text>
            <Text style={styles.toggleLabel}>GPS Active</Text>
            <Switch
              value={gpsActive}
              onValueChange={setGpsActive}
              trackColor={{ false: "#374151", true: "#10b981" }}
              thumbColor={gpsActive ? "#ecfdf5" : "#9ca3af"}
            />
          </View>
        </View>
      </View>

      {/* Status Banner */}
      {noInternet || activeIncident?.status === "draft_local" || pendingOutboxCount > 0 ? (
        <View style={[styles.statusBanner, styles.offlineBanner]}>
          <Text style={styles.bannerTitle}>⚠️ NOT SENT — Waiting for Network</Text>
          <Text style={styles.bannerSub}>
            {pendingOutboxCount > 0
              ? `SOS queued in persistent outbox (${pendingOutboxCount} pending). Will auto-sync when network returns.`
              : "SOS queued in local encrypted outbox. Will auto-sync when network returns."}
          </Text>
        </View>
      ) : activeIncident?.status === "acknowledged" || activeIncident?.alert_status === "guardian_acknowledged" ? (
        <View style={[styles.statusBanner, styles.ackBanner]}>
          <Text style={styles.bannerTitle}>🟢 Guardian Acknowledged Alert</Text>
          <Text style={styles.bannerSub}>
            {activeIncident?.acknowledgements?.[0]?.guardian_name || "Mom"} acknowledged your emergency alert.
          </Text>
        </View>
      ) : activeIncident ? (
        <View style={[styles.statusBanner, styles.activeBanner]}>
          <Text style={styles.bannerTitle}>🚨 SOS Alert Broadcasted</Text>
          <Text style={styles.bannerSub}>Escalating push notifications to 4 guardians...</Text>
        </View>
      ) : (
        <View style={styles.statusBanner}>
          <View style={styles.statusRow}>
            <Text style={styles.statusGreenDot}>🟢</Text>
            <Text style={styles.statusTitle}>Status: Safe & Protected</Text>
          </View>
          <Text style={styles.statusSub}>All safety sensors & guardians active</Text>
        </View>
      )}

      {/* Central Circular SOS Button */}
      {/* onPress removed intentionally: hold (onPressIn/onPressOut) is the sole trigger to prevent double-fire */}
      <View style={styles.sosContainer}>
        <Pressable
          onPressIn={startHold}
          onPressOut={cancelHold}
          style={styles.sosButton}
        >
          <Animated.View style={[styles.progressFill, { width: fillWidth }]} />
          <View style={styles.sosContent}>
            <Text style={styles.sosTitle}>SOS</Text>
            <Text style={styles.sosSubtitle}>HOLD 1.5 SEC FOR HELP</Text>
          </View>
        </Pressable>
      </View>

      {/* Active Incident Resolve Option */}
      {activeIncident && activeIncident.status !== "resolved" && (
        <TouchableOpacity onPress={handleResolveIncident} style={styles.resolveBtn}>
          <Text style={styles.resolveBtnText}>✅ Mark Myself Safe & Resolve SOS</Text>
        </TouchableOpacity>
      )}

      {/* 4 Quick Action Cards Grid (2x2) */}
      <View style={styles.quickGrid}>
        <TouchableOpacity onPress={() => router.push("/journey" as any)} style={styles.quickCard}>
          <Text style={styles.cardIcon}>🚗</Text>
          <Text style={styles.cardTitle}>Safe Journey</Text>
          <Text style={styles.cardSub}>ETA & Check-in alerts</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/triggers" as any)} style={styles.quickCard}>
          <Text style={styles.cardIcon}>📱</Text>
          <Text style={styles.cardTitle}>Shake Alert</Text>
          <Text style={styles.cardSub}>Gesture countdown</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/triggers" as any)} style={styles.quickCard}>
          <Text style={styles.cardIcon}>🗣️</Text>
          <Text style={styles.cardTitle}>Voice Trigger</Text>
          <Text style={styles.cardSub}>"Help" / "Bachao"</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/incident" as any)} style={styles.quickCard}>
          <Text style={styles.cardIcon}>📋</Text>
          <Text style={styles.cardTitle}>Guardian Log</Text>
          <Text style={styles.cardSub}>Ack & Status sync</Text>
        </TouchableOpacity>
      </View>

      {/* Live GPS Safety Radar Section */}
      <View style={styles.radarSection}>
        <View style={styles.radarHeader}>
          <Text style={styles.radarTitle}>▶ Live GPS Safety Radar</Text>
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>Active</Text>
          </View>
        </View>

        <Text style={styles.coordText}>
          Coordinates: {location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : "28.6139, 77.2090"}
        </Text>
        <Text style={styles.accuracyText}>
          Accuracy: ±{location?.accuracy || 12} meters • Updated just now
        </Text>

        {/* Interactive OpenStreetMap & Safetipin Crowd Radar */}
        <SafetyMap
          latitude={location?.latitude || 28.6139}
          longitude={location?.longitude || 77.2090}
          accuracy={location?.accuracy || 12}
          crowdZones={crowdZones}
          hazards={hazards}
          isSosActive={!!activeIncident && activeIncident.status !== "resolved"}
          height={280}
        />

        {/* bSafe & Safetipin Quick Action Buttons */}
        <View style={styles.quickActionsBar}>
          <TouchableOpacity
            onPress={() => setShowEvidenceModal(true)}
            activeOpacity={0.8}
            style={[styles.quickActionBtn, styles.evidenceBtn]}
          >
            <Text style={styles.quickActionIcon}>🎥</Text>
            <Text style={styles.quickActionLabel}>bSafe Evidence</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowLiveShareModal(true)}
            activeOpacity={0.8}
            style={[styles.quickActionBtn, styles.liveShareBtn]}
          >
            <Text style={styles.quickActionIcon}>📡</Text>
            <Text style={styles.quickActionLabel}>Live Track Link</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setShowReportHazardModal(true)}
            activeOpacity={0.8}
            style={[styles.quickActionBtn, styles.pinHazardBtn]}
          >
            <Text style={styles.quickActionIcon}>📍</Text>
            <Text style={styles.quickActionLabel}>Pin Hazard</Text>
          </TouchableOpacity>
        </View>

        {/* My Safetipin Area Safety Score Card */}
        {safetyScore && (
          <View style={styles.safetyScoreCard}>
            <View style={styles.safetyScoreHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.safetyScoreTag}>MY SAFETIPIN • AREA SAFETY AUDIT</Text>
                <Text style={styles.safetyScoreTitle}>
                  {safetyScore.grade === "HIGHLY_SAFE"
                    ? "🟢 Highly Safe Perimeter"
                    : safetyScore.grade === "MODERATE_CAUTION"
                    ? "🟡 Moderate Caution Zone"
                    : "🔴 High Alert Zone"}
                </Text>
              </View>
              <View style={styles.scoreBadgeCircle}>
                <Text style={styles.scoreBadgeNum}>{safetyScore.score}</Text>
                <Text style={styles.scoreBadgeMax}>/10</Text>
              </View>
            </View>

            <Text style={styles.safetyScoreSummary}>{safetyScore.summary}</Text>

            <View style={styles.safetyParamGrid}>
              <View style={styles.paramItem}>
                <Text style={styles.paramEmoji}>💡</Text>
                <Text style={styles.paramLabel}>Lighting</Text>
                <Text style={styles.paramVal}>{safetyScore.parameters.lighting}/10</Text>
              </View>
              <View style={styles.paramItem}>
                <Text style={styles.paramEmoji}>👥</Text>
                <Text style={styles.paramLabel}>Crowd Density</Text>
                <Text style={styles.paramVal}>{safetyScore.parameters.crowdDensity}/10</Text>
              </View>
              <View style={styles.paramItem}>
                <Text style={styles.paramEmoji}>👮</Text>
                <Text style={styles.paramLabel}>Security/Police</Text>
                <Text style={styles.paramVal}>{safetyScore.parameters.securityPresence}/10</Text>
              </View>
              <View style={styles.paramItem}>
                <Text style={styles.paramEmoji}>🚶</Text>
                <Text style={styles.paramLabel}>Feeling/Walk</Text>
                <Text style={styles.paramVal}>{safetyScore.parameters.feeling}/10</Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* 3-Second Cancellation Modal */}
      <Modal visible={showCountdown} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🚨 SOS TRIGGERED</Text>
            <Text style={styles.modalSub}>
              Broadcasting incident & live coordinates to your guardians in:
            </Text>

            <View style={styles.countdownBadge}>
              <Text style={styles.countdownNumber}>{countdownSeconds}</Text>
              <Text style={styles.countdownUnit}>SEC</Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={cancelCountdownModal} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>CANCEL ALERT</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  cancelCountdownModal();
                  fireSOSAlert("manual");
                }}
                style={styles.sendNowBtn}
              >
                <Text style={styles.sendNowBtnText}>SEND NOW ⚡</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* bSafe Emergency Evidence Camera Viewfinder Modal */}
      <EvidenceRecorderModal
        visible={showEvidenceModal}
        onClose={() => setShowEvidenceModal(false)}
        incidentId={activeIncident?.id}
        latitude={location?.latitude || 28.6139}
        longitude={location?.longitude || 77.2090}
      />

      {/* bSafe Real-Time Trusted Network Live Share Modal */}
      <LiveShareModal
        visible={showLiveShareModal}
        onClose={() => setShowLiveShareModal(false)}
        incidentId={activeIncident?.id}
        latitude={location?.latitude || 28.6139}
        longitude={location?.longitude || 77.2090}
      />

      {/* My Safetipin Community Hazard Pinning Modal */}
      <ReportHazardModal
        visible={showReportHazardModal}
        onClose={() => setShowReportHazardModal(false)}
        latitude={location?.latitude || 28.6139}
        longitude={location?.longitude || 77.2090}
        onHazardReported={(newHazard) => {
          setHazards((prev) => [newHazard, ...prev]);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080d1a"
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 40
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  brandContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  shieldIcon: {
    fontSize: 20
  },
  brandTitle: {
    color: "#ec4899",
    fontSize: 18,
    fontWeight: "900"
  },
  guardiansLink: {
    paddingVertical: 4,
    paddingHorizontal: 8
  },
  guardiansLinkText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "700"
  },
  greetingTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 14
  },
  simulatorCard: {
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14
  },
  simulatorHeader: {
    color: "#ec4899",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 10
  },
  simulatorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  toggleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  redDot: { fontSize: 12 },
  greenDot: { fontSize: 12 },
  toggleLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600"
  },
  statusBanner: {
    backgroundColor: "#072026",
    borderWidth: 1,
    borderColor: "#0f766e",
    borderRadius: 18,
    padding: 16,
    marginBottom: 20
  },
  offlineBanner: {
    backgroundColor: "#451a03",
    borderColor: "#d97706"
  },
  activeBanner: {
    backgroundColor: "#450a0a",
    borderColor: "#dc2626"
  },
  ackBanner: {
    backgroundColor: "#022c22",
    borderColor: "#059669"
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  statusGreenDot: { fontSize: 14 },
  statusTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800"
  },
  bannerTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  statusSub: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 4
  },
  bannerSub: {
    color: "#cbd5e1",
    fontSize: 12,
    marginTop: 4
  },
  sosContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12
  },
  sosButton: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.75,
    shadowRadius: 20,
    elevation: 15,
    overflow: "hidden"
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.3)"
  },
  sosContent: {
    alignItems: "center",
    justifyContent: "center"
  },
  sosTitle: {
    color: "#FFFFFF",
    fontSize: 44,
    fontWeight: "900",
    letterSpacing: 2
  },
  sosSubtitle: {
    color: "#fecaca",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    letterSpacing: 0.5
  },
  resolveBtn: {
    backgroundColor: "#064e3b",
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#34d399",
    alignItems: "center",
    marginVertical: 12
  },
  resolveBtnText: {
    color: "#d1fae5",
    fontWeight: "800",
    fontSize: 14
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginVertical: 14,
    gap: 10
  },
  quickCard: {
    width: "48%",
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 18,
    padding: 16,
    minHeight: 100
  },
  cardIcon: {
    fontSize: 22,
    marginBottom: 8
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4
  },
  cardSub: {
    color: "#64748b",
    fontSize: 12
  },
  radarSection: {
    marginTop: 10,
    marginBottom: 20
  },
  radarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  },
  radarTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800"
  },
  activeBadge: {
    backgroundColor: "#0284c7",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12
  },
  activeBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700"
  },
  coordText: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 2
  },
  accuracyText: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 2,
    marginBottom: 12
  },
  radarMapBox: {
    backgroundColor: "#0c1a30",
    borderWidth: 1,
    borderColor: "#1e3a8a",
    borderRadius: 20,
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center"
  },
  mapPin: {
    fontSize: 28,
    marginBottom: 6
  },
  mapTrackingTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800"
  },
  mapTrackingSub: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 4
  },
  quickActionsBar: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    marginBottom: 16
  },
  quickActionBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1
  },
  evidenceBtn: {
    backgroundColor: "#1e1b4b",
    borderColor: "#6366f1"
  },
  liveShareBtn: {
    backgroundColor: "#082f49",
    borderColor: "#0284c7"
  },
  pinHazardBtn: {
    backgroundColor: "#311029",
    borderColor: "#ec4899"
  },
  quickActionIcon: {
    fontSize: 18,
    marginBottom: 4
  },
  quickActionLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center"
  },
  safetyScoreCard: {
    backgroundColor: "#0d1527",
    borderWidth: 1,
    borderColor: "#1e3a8a",
    borderRadius: 18,
    padding: 16,
    marginBottom: 10
  },
  safetyScoreHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  safetyScoreTag: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  safetyScoreTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2
  },
  scoreBadgeCircle: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "#064e3b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#10b981"
  },
  scoreBadgeNum: {
    color: "#34d399",
    fontSize: 20,
    fontWeight: "900"
  },
  scoreBadgeMax: {
    color: "#a7f3d0",
    fontSize: 11,
    fontWeight: "700"
  },
  safetyScoreSummary: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12
  },
  safetyParamGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#090e1d",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b"
  },
  paramItem: {
    alignItems: "center"
  },
  paramEmoji: {
    fontSize: 14
  },
  paramLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2
  },
  paramVal: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#0d1527",
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "#ef4444",
    padding: 24,
    alignItems: "center"
  },
  modalTitle: {
    color: "#ef4444",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 8
  },
  modalSub: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20
  },
  countdownBadge: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#7f1d1d",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
    borderWidth: 3,
    borderColor: "#ef4444"
  },
  countdownNumber: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "900"
  },
  countdownUnit: {
    color: "#fecaca",
    fontSize: 10,
    fontWeight: "700"
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%"
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#334155",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center"
  },
  cancelBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13
  },
  sendNowBtn: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center"
  },
  sendNowBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13
  },
  signOutHeaderBtn: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  signOutHeaderBtnText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "700",
  }
});
