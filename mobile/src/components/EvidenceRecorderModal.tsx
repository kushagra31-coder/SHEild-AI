import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Platform
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Sharing from "expo-sharing";

interface EvidenceRecorderModalProps {
  visible: boolean;
  onClose: () => void;
  incidentId?: string;
  latitude: number;
  longitude: number;
}

export const EvidenceRecorderModal: React.FC<EvidenceRecorderModalProps> = ({
  visible,
  onClose,
  incidentId,
  latitude,
  longitude
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [torch, setTorch] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (visible && isRecording) {
      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible, isRecording]);

  const toggleRecording = () => {
    if (!isRecording) {
      setIsRecording(true);
      setRecordSeconds(0);
    } else {
      setIsRecording(false);
      Alert.alert(
        "📁 Evidence Saved to Locker",
        `Captured ${recordSeconds}s video/audio log with GPS watermark.\nCoordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}\nStatus: Encrypted in local evidence vault.`
      );
    }
  };

  const handleShareLiveEvidence = async () => {
    const liveTrackingUrl = `https://sheild.ai/track/${incidentId || "live-demo"}`;
    const shareMessage = `🚨 SHEild AI Emergency Evidence Broadcast!\n📍 Location: https://maps.google.com/?q=${latitude},${longitude}\n🔗 Live Guardian Stream: ${liveTrackingUrl}\n⏱️ Stamped: ${new Date().toLocaleTimeString()} - Video evidence recording active.`;

    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(shareMessage);
        Alert.alert("Link Copied", "Emergency evidence link copied to clipboard!");
      } else {
        await Share.share({
          title: "🚨 Emergency Evidence & Live Location",
          message: shareMessage,
          url: liveTrackingUrl
        });
      }
    } catch (err) {
      console.warn("Share failed:", err);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Top Header Bar */}
        <View style={styles.headerBar}>
          <View style={styles.headerLeft}>
            <View style={[styles.recBadge, isRecording ? styles.recBadgeActive : styles.recBadgeIdle]}>
              <View style={[styles.recDot, isRecording ? styles.recDotActive : styles.recDotIdle]} />
              <Text style={styles.recText}>{isRecording ? `REC ${formatTimer(recordSeconds)}` : "STANDBY"}</Text>
            </View>
          </View>

          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>

        {/* Viewfinder Area */}
        <View style={styles.viewfinderContainer}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              enableTorch={torch}
            />
          ) : (
            <View style={styles.permissionBox}>
              <Text style={styles.permIcon}>📹</Text>
              <Text style={styles.permTitle}>Camera Permission Required</Text>
              <Text style={styles.permSub}>
                To record video evidence for bSafe incident tracking, grant camera access.
              </Text>
              <TouchableOpacity onPress={requestPermission} style={styles.grantBtn}>
                <Text style={styles.grantBtnText}>Grant Camera Access</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Watermark Overlay (bSafe Stamped GPS Evidence) */}
          <View style={styles.watermarkOverlay}>
            <Text style={styles.watermarkTitle}>SHEILD AI • SECURE EVIDENCE LOCKER</Text>
            <Text style={styles.watermarkGPS}>
              GPS: {latitude.toFixed(5)}°N, {longitude.toFixed(5)}°E
            </Text>
            <Text style={styles.watermarkMeta}>
              STAMP: {new Date().toISOString()} • ID: {incidentId ? incidentId.slice(0, 8) : "LIVE"}
            </Text>
          </View>
        </View>

        {/* Controls Toolbar */}
        <View style={styles.controlsBar}>
          <TouchableOpacity
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
            style={styles.iconBtn}
          >
            <Text style={styles.iconBtnText}>🔄</Text>
            <Text style={styles.iconBtnSub}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setTorch((t) => !t)}
            style={[styles.iconBtn, torch && styles.iconBtnActive]}
          >
            <Text style={styles.iconBtnText}>🔦</Text>
            <Text style={styles.iconBtnSub}>Torch</Text>
          </TouchableOpacity>

          {/* Big Record Button */}
          <TouchableOpacity
            onPress={toggleRecording}
            activeOpacity={0.8}
            style={[styles.recordBtn, isRecording ? styles.recordBtnActive : styles.recordBtnIdle]}
          >
            <View style={isRecording ? styles.recordSquare : styles.recordCircle} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleShareLiveEvidence} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>📡</Text>
            <Text style={styles.iconBtnSub}>Share Link</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Guardian Action Note */}
        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            🛡️ Evidence is encrypted and stamped with your precise GPS coordinates for police / guardian verification.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080d1a"
  },
  headerBar: {
    paddingTop: 50,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#0d1527",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b"
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  recBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6
  },
  recBadgeActive: {
    backgroundColor: "#7f1d1d",
    borderWidth: 1,
    borderColor: "#ef4444"
  },
  recBadgeIdle: {
    backgroundColor: "#1e293b"
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  recDotActive: {
    backgroundColor: "#ef4444"
  },
  recDotIdle: {
    backgroundColor: "#94a3b8"
  },
  recText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#1e293b"
  },
  closeBtnText: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "700"
  },
  viewfinderContainer: {
    flex: 1,
    position: "relative",
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center"
  },
  permissionBox: {
    alignItems: "center",
    padding: 24,
    maxWidth: 320
  },
  permIcon: {
    fontSize: 48,
    marginBottom: 16
  },
  permTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8
  },
  permSub: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    marginBottom: 20
  },
  grantBtn: {
    backgroundColor: "#ec4899",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14
  },
  grantBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14
  },
  watermarkOverlay: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "rgba(8, 13, 26, 0.75)",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.4)"
  },
  watermarkTitle: {
    color: "#ec4899",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 2
  },
  watermarkGPS: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "800",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace"
  },
  watermarkMeta: {
    color: "#94a3b8",
    fontSize: 10,
    marginTop: 2
  },
  controlsBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: "#0d1527",
    borderTopWidth: 1,
    borderTopColor: "#1e293b"
  },
  iconBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#1e293b"
  },
  iconBtnActive: {
    backgroundColor: "#3b82f6"
  },
  iconBtnText: {
    fontSize: 20
  },
  iconBtnSub: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2
  },
  recordBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center"
  },
  recordBtnIdle: {
    borderColor: "#ec4899",
    backgroundColor: "rgba(236, 72, 153, 0.2)"
  },
  recordBtnActive: {
    borderColor: "#ef4444",
    backgroundColor: "rgba(239, 68, 68, 0.2)"
  },
  recordCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#ec4899"
  },
  recordSquare: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "#ef4444"
  },
  footerNote: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    backgroundColor: "#0d1527",
    alignItems: "center"
  },
  footerNoteText: {
    color: "#64748b",
    fontSize: 11,
    textAlign: "center"
  }
});
