import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Share,
  Alert,
  Platform
} from "react-native";

interface LiveShareModalProps {
  visible: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  incidentId?: string;
}

export const LiveShareModal: React.FC<LiveShareModalProps> = ({
  visible,
  onClose,
  latitude,
  longitude,
  incidentId
}) => {
  const [copied, setCopied] = useState(false);
  const liveUrl = `https://sheild.ai/track/${incidentId || "live-safe"}`;

  const shareText = `🛡️ SHEild AI Live Tracking Link:\nI am sharing my live GPS location with you.\n📍 Coordinates: https://maps.google.com/?q=${latitude},${longitude}\n🔗 Real-time Track: ${liveUrl}\nBattery: 88% • Updated live.`;

  const handleWhatsApp = async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(shareText)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Share.share({ message: shareText });
      }
    } catch (e) {
      await Share.share({ message: shareText });
    }
  };

  const handleSMS = async () => {
    const url = `sms:?body=${encodeURIComponent(shareText)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Share.share({ message: shareText });
      }
    } catch (e) {
      await Share.share({ message: shareText });
    }
  };

  const handleCopy = async () => {
    setCopied(true);
    if (Platform.OS === "web") {
      await navigator.clipboard.writeText(liveUrl);
    } else {
      await Share.share({ message: liveUrl });
    }
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Text style={styles.shieldIcon}>📡</Text>
              <View>
                <Text style={styles.title}>Live Guardian Sharing</Text>
                <Text style={styles.sub}>bSafe Real-Time Trusted Network</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Link Box */}
          <View style={styles.linkBox}>
            <Text style={styles.linkLabel}>PROTECTED LIVE LINK</Text>
            <Text style={styles.linkText} numberOfLines={1}>
              {liveUrl}
            </Text>
            <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
              <Text style={styles.copyBtnText}>{copied ? "✓ Copied" : "Copy Link"}</Text>
            </TouchableOpacity>
          </View>

          {/* Real-time stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>LATITUDE</Text>
              <Text style={styles.statVal}>{latitude.toFixed(4)}°N</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>LONGITUDE</Text>
              <Text style={styles.statVal}>{longitude.toFixed(4)}°E</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>NETWORK</Text>
              <Text style={[styles.statVal, { color: "#34d399" }]}>Active 🟢</Text>
            </View>
          </View>

          {/* Fast Share Buttons */}
          <Text style={styles.actionsHeader}>INSTANT 1-TAP BROADCAST</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity onPress={handleWhatsApp} style={[styles.shareBtn, styles.whatsappBtn]}>
              <Text style={styles.btnIcon}>💬</Text>
              <Text style={styles.shareBtnText}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSMS} style={[styles.shareBtn, styles.smsBtn]}>
              <Text style={styles.btnIcon}>✉️</Text>
              <Text style={styles.shareBtnText}>SMS Alert</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => Share.share({ message: shareText })} style={[styles.shareBtn, styles.moreBtn]}>
              <Text style={styles.btnIcon}>🔗</Text>
              <Text style={styles.shareBtnText}>Share Sheet</Text>
            </TouchableOpacity>
          </View>

          {/* Guardian list status */}
          <View style={styles.guardianStatusBox}>
            <Text style={styles.guardianStatusTitle}>Trusted Network Status</Text>
            <View style={styles.guardianRow}>
              <Text style={styles.guardianName}>Mom (Mother)</Text>
              <Text style={styles.guardianTag}>Live Link Sync Ready</Text>
            </View>
            <View style={styles.guardianRow}>
              <Text style={styles.guardianName}>Sister (Pooja)</Text>
              <Text style={styles.guardianTag}>Live Link Sync Ready</Text>
            </View>
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  shieldIcon: {
    fontSize: 26
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
  closeBtn: {
    padding: 6
  },
  closeText: {
    color: "#94a3b8",
    fontSize: 18,
    fontWeight: "700"
  },
  linkBox: {
    backgroundColor: "#080d1a",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 14,
    padding: 12,
    marginBottom: 16
  },
  linkLabel: {
    color: "#ec4899",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 4
  },
  linkText: {
    color: "#f8fafc",
    fontSize: 13,
    marginBottom: 10
  },
  copyBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  copyBtnText: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800"
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#090e1d",
    padding: 12,
    borderRadius: 12,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#1e293b"
  },
  statItem: {
    alignItems: "center"
  },
  statLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "800"
  },
  statVal: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2
  },
  actionsHeader: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 10
  },
  btnRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18
  },
  shareBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  whatsappBtn: {
    backgroundColor: "#15803d"
  },
  smsBtn: {
    backgroundColor: "#0369a1"
  },
  moreBtn: {
    backgroundColor: "#475569"
  },
  btnIcon: {
    fontSize: 16,
    marginBottom: 2
  },
  shareBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800"
  },
  guardianStatusBox: {
    backgroundColor: "#090e1d",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1e293b"
  },
  guardianStatusTitle: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 8
  },
  guardianRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4
  },
  guardianName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600"
  },
  guardianTag: {
    color: "#34d399",
    fontSize: 11,
    fontWeight: "700"
  }
});
