import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity
} from "react-native";
import { fetchIncidentsHistoryAPI, IncidentResponse } from "../../src/services/api";

export default function IncidentScreen() {
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadIncidents = async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const list = await fetchIncidentsHistoryAPI();
      if (list && Array.isArray(list)) {
        setIncidents(list);
      }
    } catch (e: any) {
      setFetchError(e?.message || "Failed to connect to backend server");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
  }, []);

  const latestActive = incidents.find(i => i.status !== "resolved") || incidents[0];
  const alertStatus = latestActive?.alert_status || "queued";
  const currentStep = alertStatus === "guardian_acknowledged" ? 4 : alertStatus === "provider_accepted" ? 2 : 1;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Pink Step Badge */}
      <Text style={styles.stepBadge}>STEPS 5 & 8 - STATUS SYNC & GUARDIAN PORTAL</Text>

      <Text style={styles.title}>Incident Status & Guardian Ack 📋</Text>
      <Text style={styles.sub}>Authoritative server state transitions and simulated guardian web dashboard.</Text>

      {/* BOX 4 - REAL-TIME STATUS MACHINE PIPELINE */}
      <View style={styles.card}>
        <Text style={styles.boxHeader}>BOX 4 - REAL-TIME STATUS MACHINE PIPELINE</Text>
        <View style={styles.pipelineRow}>
          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, currentStep >= 1 && styles.circleActive]}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.stepLabel}>Queued</Text>
          </View>

          <View style={[styles.lineConnector, currentStep >= 2 && styles.lineActive]} />

          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, currentStep >= 2 && styles.circleActive]}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={styles.stepLabel}>Received/Accepted</Text>
          </View>

          <View style={[styles.lineConnector, currentStep >= 3 && styles.lineActive]} />

          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, currentStep >= 3 && styles.circleActive]}>
              <Text style={styles.stepNum}>3</Text>
            </View>
            <Text style={styles.stepLabel}>Push Sent</Text>
          </View>

          <View style={[styles.lineConnector, currentStep >= 4 && styles.lineActive]} />

          <View style={styles.stepItem}>
            <View style={[styles.stepCircle, currentStep >= 4 && styles.circleActive]}>
              <Text style={styles.stepNum}>4</Text>
            </View>
            <Text style={styles.stepLabel}>Guardian Ack</Text>
          </View>
        </View>
      </View>

      {/* BOX 5 - SIMULATED GUARDIAN WEB DASHBOARD */}
      <View style={styles.card}>
        <Text style={styles.boxHeader}>BOX 5 - SIMULATED GUARDIAN WEB DASHBOARD</Text>
        {latestActive && latestActive.status !== "resolved" ? (
          <View style={styles.guardianDashboardBox}>
            <View style={[styles.greenStatusCircle, { backgroundColor: "#7f1d1d" }]}>
              <Text style={styles.greenCheckIcon}>🚨</Text>
            </View>
            <Text style={styles.noIncidentTitle}>Active Emergency Incident #{latestActive.id.slice(0, 8)}</Text>
            <Text style={styles.noIncidentSub}>
              Trigger: {(latestActive.trigger || "manual").toUpperCase()} • Status: {(latestActive.alert_status || "queued").toUpperCase()}
              {latestActive.alert_status === "guardian_acknowledged" ? "\n🟢 Guardian Acknowledged!" : "\n⏳ Awaiting Guardian Portal Response..."}
            </Text>
          </View>
        ) : (
          <View style={styles.guardianDashboardBox}>
            <View style={styles.greenStatusCircle}>
              <Text style={styles.greenCheckIcon}>🟢</Text>
            </View>
            <Text style={styles.noIncidentTitle}>No Active Emergency Incident</Text>
            <Text style={styles.noIncidentSub}>
              Trigger an SOS from the Dashboard or Triggers tab to test the full backend & guardian acknowledgement pipeline.
            </Text>
          </View>
        )}
      </View>

      {/* INCIDENT HISTORY */}
      <Text style={styles.sectionHeader}>INCIDENT HISTORY ({incidents.length})</Text>

      {isLoading ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator size="small" color="#ec4899" />
          <Text style={[styles.emptyText, { marginTop: 8 }]}>Loading incident audit log...</Text>
        </View>
      ) : fetchError ? (
        <View style={styles.emptyCard}>
          <Text style={[styles.emptyText, { color: "#f87171", fontWeight: "700" }]}>
            ⚠️ Backend Unreachable
          </Text>
          <Text style={[styles.emptyText, { fontSize: 11, color: "#94a3b8", marginTop: 4, textAlign: "center" }]}>
            Set EXPO_PUBLIC_API_URL in .env to your PC's LAN IP address when testing on a physical device.
          </Text>
          <TouchableOpacity onPress={loadIncidents} activeOpacity={0.7} style={styles.refreshBtn}>
            <Text style={styles.refreshBtnText}>🔄 Retry Audit Log</Text>
          </TouchableOpacity>
        </View>
      ) : incidents.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No past emergency incidents recorded. Your safety log is clean.</Text>
          <TouchableOpacity onPress={loadIncidents} activeOpacity={0.7} style={[styles.refreshBtn, { marginTop: 12 }]}>
            <Text style={styles.refreshBtnText}>🔄 Refresh Audit Log</Text>
          </TouchableOpacity>
        </View>
      ) : (
        incidents.map((i) => (
          <View key={i.id} style={styles.incidentCard}>
            <View style={styles.row}>
              <Text style={styles.triggerText}>{(i.trigger || "manual").toUpperCase()} SOS</Text>
              <Text style={[styles.statusBadge, i.status === "resolved" ? styles.resolved : styles.active]}>
                {(i.status || "active").toUpperCase()}
              </Text>
            </View>
            <Text style={styles.timeText}>Triggered: {new Date(i.started_at || Date.now()).toLocaleString()}</Text>
            {i.resolved_at && (
              <Text style={styles.resolvedTime}>Resolved: {new Date(i.resolved_at).toLocaleString()}</Text>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#080d1a" },
  content: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 40 },
  stepBadge: { color: "#ec4899", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, marginBottom: 4 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginBottom: 4 },
  sub: { color: "#94a3b8", fontSize: 13, marginBottom: 20 },
  card: { backgroundColor: "#0d1527", borderWidth: 1, borderColor: "#1e293b", padding: 18, borderRadius: 20, marginBottom: 16 },
  boxHeader: { color: "#ec4899", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, marginBottom: 16 },
  pipelineRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepItem: { alignItems: "center", width: 64 },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1e293b",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6
  },
  circleActive: { backgroundColor: "#0284c7" },
  stepNum: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  stepLabel: { color: "#94a3b8", fontSize: 10, textAlign: "center", fontWeight: "600" },
  lineConnector: { flex: 1, height: 2, backgroundColor: "#1e293b", marginBottom: 16 },
  lineActive: { backgroundColor: "#0284c7" },
  guardianDashboardBox: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 10 },
  greenStatusCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#064e3b", justifyContent: "center", alignItems: "center", marginBottom: 12 },
  greenCheckIcon: { fontSize: 24 },
  noIncidentTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginBottom: 6 },
  noIncidentSub: { color: "#94a3b8", fontSize: 12, textAlign: "center", lineHeight: 18 },
  sectionHeader: { color: "#94a3b8", fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginBottom: 12, marginTop: 4 },
  emptyCard: { backgroundColor: "#0d1527", padding: 24, borderRadius: 16, alignItems: "center", borderWidth: 1, borderColor: "#1e293b" },
  emptyText: { color: "#64748b", fontSize: 13 },
  incidentCard: { backgroundColor: "#0d1527", padding: 16, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: "#1e293b" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  triggerText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  statusBadge: { fontSize: 11, fontWeight: "800", paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  resolved: { backgroundColor: "#064e3b", color: "#34d399" },
  active: { backgroundColor: "#7f1d1d", color: "#ef4444" },
  timeText: { color: "#94a3b8", fontSize: 12, marginTop: 6 },
  resolvedTime: { color: "#64748b", fontSize: 12, marginTop: 2 },
  refreshBtn: { backgroundColor: "#1e293b", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#334155" },
  refreshBtnText: { color: "#38bdf8", fontSize: 12, fontWeight: "700" }
});
