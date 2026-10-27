import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
  Alert,
  Linking
} from "react-native";
import { Audio } from "expo-av";
import { voiceTriggerEngine, VoiceState } from "../../src/services/voice-trigger";
import { createIncidentAPI } from "../../src/services/api";
import { offlineOutbox } from "../../src/services/offline-outbox";

export default function TriggersScreen() {
  const [shakeEnabled, setShakeEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const [sirenPlaying, setSirenPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      voiceTriggerEngine.stopListening();
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const handleVoiceToggle = async (value: boolean) => {
    setVoiceEnabled(value);

    if (value) {
      const ok = await voiceTriggerEngine.startListening({
        onStateChange: (state, transcript) => {
          setVoiceState(state);
          if (transcript) setLiveTranscript(transcript);
        },
        onKeywordDetected: (keyword) => {
          handleTriggerVoiceSOS(keyword);
        }
      });

      if (!ok) {
        console.log("Voice trigger start result:", ok);
      }
    } else {
      voiceTriggerEngine.stopListening();
      setVoiceState("idle");
      setLiveTranscript("");
    }
  };

  const handleTriggerVoiceSOS = async (keyword: string) => {
    const clientEventId = `evt_${Date.now()}_voice_${Math.random().toString(36).substr(2, 6)}`;
    
    Alert.alert("🚨 Voice Trigger Detected!", `Detected Keyword: "${keyword.toUpperCase()}". Broadcasting SOS alert.`);

    const payload = {
      client_event_id: clientEventId,
      trigger: "voice" as const,
      occurred_at: new Date().toISOString(),
      share_location: true
    };

    const res = await createIncidentAPI(payload);
    if (!res) {
      await offlineOutbox.enqueue(payload);
    }
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
      Alert.alert("Siren", "Playing alert siren audio");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.stepBadge}>STEP 2 - SAFETY SENSORS & TRIGGERS</Text>

      <Text style={styles.title}>Safety Sensors & Triggers ⚡</Text>
      <Text style={styles.sub}>Configure gesture detection, voice commands, and emergency triggers.</Text>

      {/* Shake Alert */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.titleGroup}>
            <Text style={styles.cardIcon}>📱</Text>
            <View>
              <Text style={styles.cardTitle}>Shake Alert (Gesture)</Text>
              <Text style={styles.cardSub}>Rapid 3-axis phone shake triggers SOS</Text>
            </View>
          </View>
          <Switch
            value={shakeEnabled}
            onValueChange={setShakeEnabled}
            trackColor={{ false: "#374151", true: "#be185d" }}
            thumbColor={shakeEnabled ? "#fef2f2" : "#9ca3af"}
          />
        </View>
      </View>

      {/* Voice Trigger Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.titleGroup}>
            <Text style={styles.cardIcon}>🗣️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Voice Trigger ("Help" / "Bachao")</Text>
              <Text style={styles.cardSub}>Keyword voice recognition engine</Text>
            </View>
          </View>
          <Switch
            value={voiceEnabled}
            onValueChange={handleVoiceToggle}
            trackColor={{ false: "#374151", true: "#be185d" }}
            thumbColor={voiceEnabled ? "#fef2f2" : "#9ca3af"}
          />
        </View>

        {/* UI State Readouts */}
        {voiceState === "listening" && (
          <View style={styles.stateBannerListening}>
            <Text style={styles.stateTitleListening}>🎙️ Listening for "Help" or "Bachao"...</Text>
            {liveTranscript ? (
              <Text style={styles.transcriptText}>Heard: &quot;{liveTranscript}&quot;</Text>
            ) : (
              <Text style={styles.transcriptSub}>Speak clearly near device microphone</Text>
            )}
          </View>
        )}

        {voiceState === "detected" && (
          <View style={styles.stateBannerDetected}>
            <Text style={styles.stateTitleDetected}>🚨 KEYWORD DETECTED!</Text>
            <Text style={styles.stateSubDetected}>Triggering emergency voice SOS alert...</Text>
          </View>
        )}

        {voiceState === "permission_denied" && (
          <View style={styles.stateBannerDenied}>
            <Text style={styles.stateTitleDenied}>⚠️ Microphone Permission Denied</Text>
            <Text style={styles.stateSubDenied}>Please enable microphone permission in device settings.</Text>
          </View>
        )}

        {voiceState === "unavailable" && (
          <View style={styles.stateBannerUnavailable}>
            <Text style={styles.stateTitleUnavailable}>ℹ️ Speech Engine Unavailable / Simulator Mode</Text>
            <View style={styles.manualVoiceRow}>
              <TouchableOpacity
                onPress={() => handleTriggerVoiceSOS("help")}
                style={[styles.manualVoiceSimBtn, { flex: 1 }]}
              >
                <Text style={styles.manualVoiceSimText}>Test "Help" 🗣️</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleTriggerVoiceSOS("bachao")}
                style={[styles.manualVoiceSimBtn, { flex: 1, backgroundColor: "#9d174d" }]}
              >
                <Text style={styles.manualVoiceSimText}>Test "Bachao" 🗣️</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Siren Sound Test */}
      <View style={styles.card}>
        <View style={styles.titleGroup}>
          <Text style={styles.cardIcon}>📢</Text>
          <View>
            <Text style={styles.cardTitle}>Siren Audio Horn</Text>
            <Text style={styles.cardSub}>Loud deterrent alarm audio trigger</Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={toggleSiren}
          style={[styles.sirenBtn, sirenPlaying && styles.sirenBtnActive]}
        >
          <Text style={styles.sirenBtnText}>
            {sirenPlaying ? "🔊 Stop Siren Alarm" : "📢 Test Play Loud Siren"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Helpline Dialers */}
      <View style={styles.dialerSection}>
        <Text style={styles.dialerTitle}>Emergency Helpline Hand-offs</Text>
        <View style={styles.dialerGrid}>
          <TouchableOpacity onPress={() => Linking.openURL("tel:112")} style={styles.dialerPill}>
            <Text style={styles.dialerPillText}>📞 112 Emergency</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL("tel:1091")} style={styles.dialerPill}>
            <Text style={styles.dialerPillText}>📞 1091 Women</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL("tel:1930")} style={styles.dialerPill}>
            <Text style={styles.dialerPillText}>📞 1930 Cyber</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL("tel:1098")} style={styles.dialerPill}>
            <Text style={styles.dialerPillText}>📞 1098 Child</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#080d1a" },
  content: { paddingHorizontal: 16, paddingTop: 54, paddingBottom: 40 },
  stepBadge: { color: "#ec4899", fontSize: 11, fontWeight: "900", letterSpacing: 0.5, marginBottom: 4 },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", marginBottom: 4 },
  sub: { color: "#94a3b8", fontSize: 13, marginBottom: 20 },
  card: { backgroundColor: "#0d1527", borderWidth: 1, borderColor: "#1e293b", padding: 18, borderRadius: 20, marginBottom: 14 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  cardIcon: { fontSize: 24 },
  cardTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  cardSub: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  stateBannerListening: { marginTop: 14, backgroundColor: "#064e3b", borderWidth: 1, borderColor: "#34d399", padding: 12, borderRadius: 12 },
  stateTitleListening: { color: "#d1fae5", fontWeight: "800", fontSize: 13 },
  transcriptText: { color: "#a7f3d0", fontSize: 12, marginTop: 4, fontStyle: "italic" },
  transcriptSub: { color: "#a7f3d0", fontSize: 11, marginTop: 2 },
  stateBannerDetected: { marginTop: 14, backgroundColor: "#450a0a", borderWidth: 1, borderColor: "#dc2626", padding: 12, borderRadius: 12 },
  stateTitleDetected: { color: "#fef2f2", fontWeight: "900", fontSize: 14 },
  stateSubDetected: { color: "#fecaca", fontSize: 12, marginTop: 2 },
  stateBannerDenied: { marginTop: 14, backgroundColor: "#451a03", borderWidth: 1, borderColor: "#d97706", padding: 12, borderRadius: 12 },
  stateTitleDenied: { color: "#fef3c7", fontWeight: "800", fontSize: 13 },
  stateSubDenied: { color: "#fde68a", fontSize: 12, marginTop: 2 },
  stateBannerUnavailable: { marginTop: 14, backgroundColor: "#1e293b", borderWidth: 1, borderColor: "#334155", padding: 12, borderRadius: 12 },
  stateTitleUnavailable: { color: "#cbd5e1", fontWeight: "700", fontSize: 12, marginBottom: 8 },
  manualVoiceRow: { flexDirection: "row", gap: 10 },
  manualVoiceSimBtn: { backgroundColor: "#be185d", paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  manualVoiceSimText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  sirenBtn: { backgroundColor: "#be185d", paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 14 },
  sirenBtnActive: { backgroundColor: "#ef4444" },
  sirenBtnText: { color: "#FFFFFF", fontWeight: "900", fontSize: 14 },
  dialerSection: { marginTop: 14 },
  dialerTitle: { color: "#ec4899", fontSize: 12, fontWeight: "800", textTransform: "uppercase", marginBottom: 12 },
  dialerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  dialerPill: { backgroundColor: "#0d1527", borderWidth: 1, borderColor: "#1e293b", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14 },
  dialerPillText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" }
});
