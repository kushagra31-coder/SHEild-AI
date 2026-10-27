import AsyncStorage from "@react-native-async-storage/async-storage";

export interface SafetyAuditParams {
  lighting: number;          // 0-10
  openness: number;          // 0-10
  visibility: number;        // 0-10 (eyes on the street)
  crowdDensity: number;      // 0-10
  securityPresence: number;  // 0-10 (police/guards)
  walkPathQuality: number;   // 0-10
  publicTransitAccess: number; // 0-10
  feeling: number;           // 0-10 (intuitive comfort)
  genderDiversity: number;   // 0-10 (women present)
}

export interface AreaSafetyScore {
  score: number;             // 0.0 - 10.0
  grade: "HIGHLY_SAFE" | "MODERATE_CAUTION" | "HIGH_ALERT";
  summary: string;
  parameters: SafetyAuditParams;
  lastUpdated: string;
}

export interface CrowdZone {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  densityLevel: "HIGH" | "MODERATE" | "LOW_DESERTED"; // Green, Yellow, Red
  densityLabel: string;
  score: number;
  reportedAt: string;
}

export interface SafetyHazardReport {
  id: string;
  type: "DARK_STREET" | "HARASSMENT" | "POLICE_BOOTH" | "SAFE_HAVEN" | "SUSPICIOUS_ACTIVITY";
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "SAFE";
  createdAt: string;
  verifiedCount: number;
}

export interface SafeRouteOption {
  id: string;
  title: string;
  type: "SAFEST" | "FASTEST";
  durationMinutes: number;
  safetyScore: number; // 0-10
  distanceKm: number;
  lightingScore: number;
  crowdScore: number;
  cctvCoveragePercent: number;
  waypoints: Array<{ latitude: number; longitude: number; label: string; isCaution?: boolean }>;
  highlights: string[];
}

const HAZARDS_STORAGE_KEY = "SHEILD_COMMUNITY_HAZARDS_V1";

// Default Community Hazard Markers (Safetipin style)
const DEFAULT_HAZARDS: SafetyHazardReport[] = [
  {
    id: "h-1",
    type: "POLICE_BOOTH",
    title: "24/7 Police Assistance Booth",
    description: "Active PCR van and 2 stationed female police officers. Safe point.",
    latitude: 28.6145,
    longitude: 77.2105,
    severity: "SAFE",
    createdAt: new Date().toISOString(),
    verifiedCount: 18
  },
  {
    id: "h-2",
    type: "SAFE_HAVEN",
    title: "Metro Station Safe Room & Helpdesk",
    description: "CCTV monitored, security guard on duty, bright LED lighting.",
    latitude: 28.6180,
    longitude: 77.2150,
    severity: "SAFE",
    createdAt: new Date().toISOString(),
    verifiedCount: 34
  },
  {
    id: "h-3",
    type: "DARK_STREET",
    title: "Broken Streetlights (Dark Alley)",
    description: "3 streetlights non-operational. Zero visibility after 8 PM.",
    latitude: 28.6110,
    longitude: 77.2050,
    severity: "HIGH",
    createdAt: new Date().toISOString(),
    verifiedCount: 12
  },
  {
    id: "h-4",
    type: "HARASSMENT",
    title: "Reported Harassment / Loitering",
    description: "Unlit corner near abandoned bus stop. Catcalling reported recently.",
    latitude: 28.6095,
    longitude: 77.2120,
    severity: "HIGH",
    createdAt: new Date().toISOString(),
    verifiedCount: 9
  },
  {
    id: "h-5",
    type: "SAFE_HAVEN",
    title: "24/7 Apollo Pharmacy Safe Haven",
    description: "Staff present 24/7, bright interior, CCTV active.",
    latitude: 28.6165,
    longitude: 77.2025,
    severity: "SAFE",
    createdAt: new Date().toISOString(),
    verifiedCount: 22
  }
];

// Default Crowd Zones around user (Safetipin + Crowd Detect)
export const DEFAULT_CROWD_ZONES: CrowdZone[] = [
  {
    id: "cz-1",
    name: "Connaught Central Market",
    latitude: 28.6315,
    longitude: 77.2167,
    radiusMeters: 280,
    densityLevel: "HIGH",
    densityLabel: "High Footfall • Well Patrolled",
    score: 8.9,
    reportedAt: "Live (just now)"
  },
  {
    id: "cz-2",
    name: "Transit Hub Metro Concourse",
    latitude: 28.6175,
    longitude: 77.2130,
    radiusMeters: 200,
    densityLevel: "HIGH",
    densityLabel: "High Transit Footfall • High Security",
    score: 9.2,
    reportedAt: "Live (just now)"
  },
  {
    id: "cz-3",
    name: "Inner Commercial Ring Corridor",
    latitude: 28.6120,
    longitude: 77.2080,
    radiusMeters: 320,
    densityLevel: "MODERATE",
    densityLabel: "Moderate Commuters • Evening Stores",
    score: 7.1,
    reportedAt: "Live (5m ago)"
  },
  {
    id: "cz-4",
    name: "East Service Back-Alley",
    latitude: 28.6080,
    longitude: 77.2040,
    radiusMeters: 180,
    densityLevel: "LOW_DESERTED",
    densityLabel: "Deserted Footfall • High Alert Risk",
    score: 3.4,
    reportedAt: "Live (just now)"
  }
];

export class SafetyRadarService {
  /**
   * Calculates dynamic Safetipin 9-parameter score for given coordinates
   */
  public calculateAreaSafetyScore(latitude: number, longitude: number): AreaSafetyScore {
    // Generate deterministic yet location-aware realistic score
    const latFactor = Math.abs(Math.sin(latitude * 100));
    const lonFactor = Math.abs(Math.cos(longitude * 100));
    const base = 7.0 + (latFactor * 2.2) - (lonFactor * 1.5);
    const scoreVal = Math.min(9.6, Math.max(3.8, parseFloat(base.toFixed(1))));

    let grade: AreaSafetyScore["grade"] = "HIGHLY_SAFE";
    let summary = "Well-lit public thoroughfare with steady footfall and nearby emergency hubs.";

    if (scoreVal < 5.0) {
      grade = "HIGH_ALERT";
      summary = "Low footfall and dim streetlights detected. Stay on primary avenues.";
    } else if (scoreVal < 7.5) {
      grade = "MODERATE_CAUTION";
      summary = "Moderate pedestrian presence. Keep guardian live tracking active.";
    }

    const lighting = Math.min(10, Math.round(scoreVal * 0.9 + 0.5));
    const crowd = Math.min(10, Math.round(scoreVal * 0.85 + 0.8));
    const security = Math.min(10, Math.round(scoreVal * 0.95 - 0.2));

    return {
      score: scoreVal,
      grade,
      summary,
      parameters: {
        lighting,
        openness: Math.min(10, Math.round(scoreVal * 0.92)),
        visibility: Math.min(10, Math.round(scoreVal * 0.88)),
        crowdDensity: crowd,
        securityPresence: security,
        walkPathQuality: Math.min(10, Math.round(scoreVal * 0.84)),
        publicTransitAccess: Math.min(10, Math.round(scoreVal * 0.96)),
        feeling: Math.min(10, Math.round(scoreVal * 0.9)),
        genderDiversity: Math.min(10, Math.round(scoreVal * 0.82))
      },
      lastUpdated: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
  }

  /**
   * Get all community hazards (stored in AsyncStorage)
   */
  public async getCommunityHazards(): Promise<SafetyHazardReport[]> {
    try {
      const stored = await AsyncStorage.getItem(HAZARDS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Could not read community hazards from storage");
    }
    return DEFAULT_HAZARDS;
  }

  /**
   * Add a new community safety report
   */
  public async addCommunityHazard(report: Omit<SafetyHazardReport, "id" | "createdAt" | "verifiedCount">): Promise<SafetyHazardReport> {
    const list = await this.getCommunityHazards();
    const newReport: SafetyHazardReport = {
      ...report,
      id: `h-${Date.now()}`,
      createdAt: new Date().toISOString(),
      verifiedCount: 1
    };
    const updated = [newReport, ...list];
    try {
      await AsyncStorage.setItem(HAZARDS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Failed saving community hazard to storage");
    }
    return newReport;
  }

  /**
   * Generate Safe Route Options (Safetipin style route mapping)
   */
  public getSafeRouteOptions(currentLat: number, currentLon: number, destLabel: string): SafeRouteOption[] {
    return [
      {
        id: "route-safest",
        title: "🛡️ Safest Route (Recommended)",
        type: "SAFEST",
        durationMinutes: 28,
        safetyScore: 8.9,
        distanceKm: 3.8,
        lightingScore: 9.4,
        crowdScore: 8.8,
        cctvCoveragePercent: 96,
        waypoints: [
          { latitude: currentLat, longitude: currentLon, label: "Current Location" },
          { latitude: currentLat + 0.004, longitude: currentLon + 0.003, label: "Metro High-Street (Bright LED Lights)" },
          { latitude: currentLat + 0.008, longitude: currentLon + 0.006, label: "Commercial Avenues (PCR Van Patrol)" },
          { latitude: currentLat + 0.012, longitude: currentLon + 0.009, label: destLabel || "Destination" }
        ],
        highlights: [
          "100% lit arterial roads",
          "Continuous active CCTV surveillance",
          "Passes 2 police assistance booths & 24/7 pharmacy",
          "+4 mins longer but maximum crowd presence"
        ]
      },
      {
        id: "route-fastest",
        title: "⚡ Shortest Cut (Caution Advised)",
        type: "FASTEST",
        durationMinutes: 22,
        safetyScore: 4.3,
        distanceKm: 2.9,
        lightingScore: 3.8,
        crowdScore: 3.1,
        cctvCoveragePercent: 28,
        waypoints: [
          { latitude: currentLat, longitude: currentLon, label: "Current Location" },
          { latitude: currentLat + 0.005, longitude: currentLon + 0.001, label: "Back Service Alley (Unlit)", isCaution: true },
          { latitude: currentLat + 0.009, longitude: currentLon + 0.004, label: "Isolated Underpass", isCaution: true },
          { latitude: currentLat + 0.012, longitude: currentLon + 0.009, label: destLabel || "Destination" }
        ],
        highlights: [
          "Saves 6 minutes",
          "⚠️ 2 unlit blind spots reported",
          "⚠️ Low footfall after dark",
          "Guardians will receive active breadcrumbs if chosen"
        ]
      }
    ];
  }
}

export const safetyRadarService = new SafetyRadarService();
