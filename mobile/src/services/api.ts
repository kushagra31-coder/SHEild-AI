import { Platform } from "react-native";
import { getAccessToken } from "./auth";

const getApiBaseUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envUrl) {
    return envUrl;
  }
  if (Platform.OS === "android") {
    console.warn(
      "[SHEild AI API] Notice: EXPO_PUBLIC_API_URL is not configured. Defaulting to Android emulator alias (http://10.0.2.2:8000/api/v1). " +
      "If running on a physical Android device, requests to 10.0.2.2 will time out. Set EXPO_PUBLIC_API_URL in .env to your PC's LAN IP (e.g. http://192.168.x.x:8000/api/v1) or deployed backend URL."
    );
    return "http://10.0.2.2:8000/api/v1";
  }
  return "http://localhost:8000/api/v1";
};

const API_BASE_URL = getApiBaseUrl();

export const DEFAULT_REQUEST_TIMEOUT_MS = 7000;

/**
 * Fetch wrapper with AbortController timeout to prevent infinite UI loading hangs
 * on physical devices when network endpoints or localhost aliases are unreachable.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export interface CreateIncidentPayload {
  client_event_id: string;
  trigger: "manual" | "shake" | "voice_keyword" | "missed_check_in" | "voice" | "journey_timeout" | "other";
  occurred_at: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_m?: number;
    captured_at?: string;
  };
  share_location?: boolean;
}

export interface IncidentResponse {
  id: string;
  owner_id: string;
  client_event_id: string;
  trigger: string;
  status: "draft_local" | "pending_upload" | "active" | "acknowledged" | "resolved" | "expired";
  alert_status: "queued" | "provider_accepted" | "provider_failed" | "guardian_acknowledged";
  started_at: string;
  acknowledged_at?: string;
  resolved_at?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_m?: number;
  };
  acknowledgements?: Array<{
    guardian_id: string;
    guardian_name: string;
    note?: string;
    acknowledged_at: string;
  }>;
}

export async function createIncidentAPI(payload: CreateIncidentPayload): Promise<IncidentResponse | null> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/incidents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": payload.client_event_id,
        ...authHeader
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[API] Network error posting incident:", err);
    return null;
  }
}

export async function fetchIncidentAPI(id: string): Promise<IncidentResponse | null> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/incidents/${id}`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function resolveIncidentAPI(id: string): Promise<boolean> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/incidents/${id}/resolve`, {
      method: "POST",
      headers: { ...authHeader }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function sendLocationAPI(incidentId: string, location: { latitude: number; longitude: number; accuracy_m?: number; captured_at?: string }) {
  try {
    const authHeader = await getAuthHeader();
    const bodyPayload = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy_m: location.accuracy_m ?? 10.0,
      captured_at: location.captured_at || new Date().toISOString(),
    };
    await fetchWithTimeout(`${API_BASE_URL}/incidents/${incidentId}/location`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader
      },
      body: JSON.stringify(bodyPayload)
    }, 4000); // 4-second timeout for location pings
  } catch (err) {
    // Silent fail for background location polling
  }
}

export async function fetchGuardiansAPI() {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/guardians`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function createGuardianInviteAPI() {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/guardian-invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader
      },
      body: JSON.stringify({ display_name: "New Guardian", priority: 1 })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function createJourneyAPI(destination: string, etaMinutes: number) {
  try {
    const authHeader = await getAuthHeader();
    const eta_at = new Date(Date.now() + etaMinutes * 60000).toISOString();
    const res = await fetchWithTimeout(`${API_BASE_URL}/journeys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader
      },
      body: JSON.stringify({ destination_label: destination, eta_at: eta_at })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

export async function fetchJourneysAPI() {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/journeys`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn("[API] fetchJourneysAPI request failed:", err);
    return [];
  }
}

export async function completeJourneyAPI(id: string): Promise<boolean> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/journeys/${id}/complete`, {
      method: "POST",
      headers: { ...authHeader }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function cancelJourneyAPI(id: string): Promise<boolean> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/journeys/${id}/cancel`, {
      method: "POST",
      headers: { ...authHeader }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function checkInJourneyAPI(id: string) {
  const completed = await completeJourneyAPI(id);
  if (completed) return true;
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/journeys/${id}/check-in`, {
      method: "POST",
      headers: { ...authHeader }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function fetchIncidentsHistoryAPI(): Promise<IncidentResponse[]> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/incidents`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn("[API] fetchIncidentsHistoryAPI request failed:", err);
    return [];
  }
}
