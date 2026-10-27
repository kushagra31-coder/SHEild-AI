import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert
} from "react-native";
import { safetyRadarService, SafetyHazardReport } from "../services/safety-radar";

interface ReportHazardModalProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  onHazardReported: (hazard: SafetyHazardReport) => void;
}

export const ReportHazardModal: React.FC<ReportHazardModalProps> = ({
  visible,
  onClose,
  latitude,
  longitude,
  onHazardReported
}) => {
  const [selectedType, setSelectedType] = useState<SafetyHazardReport["type"]>("DARK_STREET");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const hazardTypes: Array<{ type: SafetyHazardReport["type"]; label: string; icon: string; severity: SafetyHazardReport["severity"] }> = [
    { type: "DARK_STREET", label: "Broken Lighting", icon: "💡", severity: "HIGH" },
    { type: "HARASSMENT", label: "Harassment / Loitering", icon: "🚨", severity: "HIGH" },
    { type: "POLICE_BOOTH", label: "Police Checkpoint", icon: "👮", severity: "SAFE" },
    { type: "SAFE_HAVEN", label: "24/7 Safe Haven", icon: "🏥", severity: "SAFE" },
    { type: "SUSPICIOUS_ACTIVITY", label: "Deserted Low Footfall", icon: "⚠️", severity: "MEDIUM" }
  ];

  const handleSubmit = async () => {
    const activeMeta = hazardTypes.find((t) => t.type === selectedType);
    const reportTitle = title.trim() || activeMeta?.label || "Safety Observation";
    const reportDesc = description.trim() || `Reported at coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

    const newHazard = await safetyRadarService.addCommunityHazard({
      type: selectedType,
      title: reportTitle,
      description: reportDesc,
      latitude: latitude || 28.6139,
      longitude: longitude || 77.2090,
      severity: activeMeta?.severity || "MEDIUM"
    });

    onHazardReported(newHazard);
    Alert.alert("✓ Community Report Pinned", "Thank you for contributing to community safety!");
    setTitle("");
    setDescription("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.iconBadge}>📍</Text>
            <View>
              <Text style={styles.title}>Pin Safety Hazard</Text>
              <Text style={styles.sub}>My Safetipin Community Crime & Safety Data</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>SELECT CATEGORY</Text>
          <View style={styles.typeGrid}>
            {hazardTypes.map((item) => {
              const isSelected = selectedType === item.type;
              return (
                <TouchableOpacity
                  key={item.type}
                  onPress={() => setSelectedType(item.type)}
                  style={[styles.typePill, isSelected && styles.typePillSelected]}
                >
                  <Text style={styles.pillIcon}>{item.icon}</Text>
                  <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.sectionLabel}>TITLE (OPTIONAL)</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Unlit corner near bus stand"
            placeholderTextColor="#64748b"
            style={styles.input}
          />

          <Text style={styles.sectionLabel}>DETAILS & OBSERVATION</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Broken bulb for 100m, poor visibility after 8 PM"
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={3}
            style={[styles.input, styles.textArea]}
          />

          <View style={styles.btnRow}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSubmit} style={styles.submitBtn}>
              <Text style={styles.submitBtnText}>Pin to Map 🚀</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#0d1527",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#1e3a8a",
    padding: 20
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16
  },
  iconBadge: {
    fontSize: 28
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900"
  },
  sub: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "700"
  },
  sectionLabel: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#090e1d",
    borderWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    gap: 6
  },
  typePillSelected: {
    backgroundColor: "#9d174d",
    borderColor: "#ec4899"
  },
  pillIcon: {
    fontSize: 14
  },
  pillText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700"
  },
  pillTextSelected: {
    color: "#FFFFFF"
  },
  input: {
    backgroundColor: "#090e1d",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    padding: 12,
    color: "#FFFFFF",
    fontSize: 13,
    marginBottom: 8
  },
  textArea: {
    height: 70,
    textAlignVertical: "top"
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center"
  },
  cancelBtnText: {
    color: "#94a3b8",
    fontWeight: "800",
    fontSize: 13
  },
  submitBtn: {
    flex: 2,
    backgroundColor: "#ec4899",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center"
  },
  submitBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 13
  }
});
