import { Platform } from "react-native";
import { getAccessToken } from "./auth";

const getApiBaseUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === "android") {
    return "http://10.0.2.2:8000/api/v1";
  }
  return "http://localhost:8000/api/v1";
};

const API_BASE_URL = getApiBaseUrl();

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export interface CreateIncidentPayload {
  client_event_id: string;
  trigger: "manual" | "shake" | "voice" | "journey_timeout";
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
    const res = await fetch(`${API_BASE_URL}/incidents`, {
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
    console.error("Network error posting incident:", err);
    return null;
  }
}

export async function fetchIncidentAPI(id: string): Promise<IncidentResponse | null> {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/incidents/${id}`, {
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
    const res = await fetch(`${API_BASE_URL}/incidents/${id}/resolve`, {
      method: "POST",
      headers: { ...authHeader }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function sendLocationAPI(incidentId: string, location: { latitude: number; longitude: number; accuracy_m?: number }) {
  try {
    const authHeader = await getAuthHeader();
    await fetch(`${API_BASE_URL}/incidents/${incidentId}/locations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader
      },
      body: JSON.stringify(location)
    });
  } catch (err) {
    // Silent fail for location polling
  }
}

export async function fetchGuardiansAPI() {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/guardians`, {
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
    const res = await fetch(`${API_BASE_URL}/guardian-invites`, {
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
    const res = await fetch(`${API_BASE_URL}/journeys`, {
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
    const res = await fetch(`${API_BASE_URL}/journeys`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function checkInJourneyAPI(id: string) {
  try {
    const authHeader = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/journeys/${id}/check-in`, {
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
    const res = await fetch(`${API_BASE_URL}/incidents`, {
      headers: { ...authHeader }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}
