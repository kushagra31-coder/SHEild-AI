import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView
} from "react-native";
import { useAuth } from "../../src/context/AuthContext";

export default function SignInScreen() {
  const { signIn, signUp, loginAsDemo } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validateForm = (): boolean => {
    setErrorMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("Email address is required.");
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return false;
    }

    if (!password) {
      setErrorMessage("Password is required.");
      return false;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return false;
    }

    if (isSignUp) {
      if (password !== confirmPassword) {
        setErrorMessage("Passwords do not match.");
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      if (isSignUp) {
        const res = await signUp(email, password, displayName, phoneNumber);
        if (res.error) {
          if (res.error.toLowerCase().includes("fetch") || res.error.toLowerCase().includes("network")) {
            setErrorMessage("Cloud Supabase is not connected. Tap 'Continue as Demo User' below to test all features locally.");
          } else {
            setErrorMessage(res.error);
          }
        }
      } else {
        const res = await signIn(email, password);
        if (res.error) {
          if (res.error.toLowerCase().includes("fetch") || res.error.toLowerCase().includes("network")) {
            setErrorMessage("Cloud Supabase is not connected. Tap 'Continue as Demo User' below to test all features locally.");
          } else {
            setErrorMessage(res.error);
          }
        }
      }
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network")) {
        setErrorMessage("Cloud Supabase is not connected. Tap 'Continue as Demo User' below to test all features locally.");
      } else {
        setErrorMessage(msg || "Authentication failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setErrorMessage(null);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.headerContainer}>
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>🛡️ SHEILD AI 2.0</Text>
            </View>
            <Text style={styles.titleText}>
              {isSignUp ? "Create Your Account" : "Welcome Back"}
            </Text>
            <Text style={styles.subtitleText}>
              {isSignUp
                ? "Register to enable verified emergency response & guardian network"
                : "Sign in to access your protection dashboard & safety triggers"}
            </Text>
          </View>

          <View style={styles.cardContainer}>
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
              </View>
            ) : null}

            {isSignUp ? (
              <>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Jane Doe"
                  placeholderTextColor="#64748b"
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                />

                <Text style={styles.inputLabel}>Phone Number (Optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +91 9876543210"
                  placeholderTextColor="#64748b"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  keyboardType="phone-pad"
                />
              </>
            ) : null}

            <Text style={styles.inputLabel}>Email Address *</Text>
            <TextInput
              style={styles.input}
              placeholder="user@example.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.inputLabel}>Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#64748b"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            {isSignUp ? (
              <>
                <Text style={styles.inputLabel}>Confirm Password *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#64748b"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            ) : null}

            <TouchableOpacity
              style={[styles.submitButton, loading && styles.disabledButton]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#0f172a" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {isSignUp ? "Create Safety Account" : "Sign In to Dashboard"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.toggleButton} onPress={toggleMode}>
              <Text style={styles.toggleText}>
                {isSignUp ? (
                  <>
                    Already have an account? <Text style={styles.toggleHighlight}>Sign In</Text>
                  </>
                ) : (
                  <>
                    Don't have an account? <Text style={styles.toggleHighlight}>Sign Up</Text>
                  </>
                )}
              </Text>
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>LOCAL TEST MODE</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.demoButton}
              onPress={() => loginAsDemo(displayName || "Akaza", email || "chouhanaditya169@gmail.com")}
              activeOpacity={0.8}
            >
              <Text style={styles.demoButtonText}>⚡ Continue as Demo User (Bypass Cloud Auth)</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#090e1d",
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: "center",
    minHeight: "100%",
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  badgeContainer: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 16,
  },
  badgeText: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  titleText: {
    color: "#f8fafc",
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitleText: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  cardContainer: {
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#1e293b",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "#ef4444",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 18,
  },
  inputLabel: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f8fafc",
    fontSize: 15,
  },
  submitButton: {
    backgroundColor: "#38bdf8",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  disabledButton: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "700",
  },
  toggleButton: {
    marginTop: 20,
    alignItems: "center",
  },
  toggleText: {
    color: "#94a3b8",
    fontSize: 14,
  },
  toggleHighlight: {
    color: "#38bdf8",
    fontWeight: "700",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#334155",
  },
  dividerText: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: 12,
  },
  demoButton: {
    backgroundColor: "#1e293b",
    borderColor: "#38bdf8",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  demoButtonText: {
    color: "#38bdf8",
    fontSize: 14,
    fontWeight: "600",
  },
});
