import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet
} from "react-native";
import { fetchIncidentsHistoryAPI, IncidentResponse } from "../../src/services/api";

export default function HistoryScreen() {
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);

  useEffect(() => {
    fetchIncidentsHistoryAPI().then(setIncidents);
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>📜 Incident History</Text>
      <Text style={styles.sub}>Past emergency activations and resolution logs</Text>

      {incidents.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No past incidents recorded</Text>
        </View>
      ) : (
        incidents.map((i) => (
          <View key={i.id} style={styles.card}>
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
  container: { flex: 1, backgroundColor: "#030712" },
  content: { padding: 20, paddingTop: 60 },
  title: { color: "#FFF", fontSize: 30, fontWeight: "900" },
  sub: { color: "#9CA3AF", fontSize: 14, marginBottom: 20 },
  emptyBox: { backgroundColor: "#111827", padding: 30, borderRadius: 16, alignItems: "center" },
  emptyText: { color: "#6B7280", fontSize: 14 },
  card: { backgroundColor: "#111827", padding: 16, borderRadius: 16, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  triggerText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  statusBadge: { fontSize: 11, fontWeight: "800", paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  resolved: { backgroundColor: "#064E3B", color: "#34D399" },
  active: { backgroundColor: "#7F1D1D", color: "#EF4444" },
  timeText: { color: "#9CA3AF", fontSize: 13, marginTop: 6 },
  resolvedTime: { color: "#6B7280", fontSize: 12, marginTop: 2 }
});
