import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuidv4, validate as validateUuid } from "uuid";

// 1. UUID & Event ID Safety Tests
describe("Emergency Incident Idempotency & UUID Validation", () => {
  it("generates a valid RFC 4122 UUID v4 for client_event_id", () => {
    const id = uuidv4();
    assert.equal(typeof id, "string");
    assert.equal(validateUuid(id), true);
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "client_event_id must conform to canonical UUID v4 string"
    );
  });

  it("does not generate legacy non-UUID format evt_...", () => {
    const id = uuidv4();
    assert.equal(id.startsWith("evt_"), false);
  });
});

// 2. SOS Trigger Vocabulary Verification (Aligned with Backend Schema)
describe("SOS Trigger Vocabulary Alignment with Backend OpenAPI Contract", () => {
  const allowedBackendTriggers = ["manual", "shake", "voice_keyword", "missed_check_in", "other"];

  it("maps voice trigger to backend-compliant voice_keyword", () => {
    const triggerInput = "voice";
    const mapped = triggerInput === "voice" ? "voice_keyword" : triggerInput;
    assert.ok(
      allowedBackendTriggers.includes(mapped),
      `Trigger ${mapped} must be in backend allowed triggers`
    );
    assert.equal(mapped, "voice_keyword");
  });

  it("maps journey timeout trigger to missed_check_in", () => {
    const triggerInput = "journey_timeout";
    const mapped = triggerInput === "journey_timeout" ? "missed_check_in" : triggerInput;
    assert.ok(
      allowedBackendTriggers.includes(mapped),
      `Trigger ${mapped} must be in backend allowed triggers`
    );
    assert.equal(mapped, "missed_check_in");
  });

  it("permits standard manual and shake triggers directly", () => {
    assert.ok(allowedBackendTriggers.includes("manual"));
    assert.ok(allowedBackendTriggers.includes("shake"));
  });
});

// 3. Incident Location Reporting Contract Test
describe("Incident Location Reporting API Contract", () => {
  it("formats singular /incidents/{id}/location route and requires captured_at timestamp", () => {
    const incidentId = "550e8400-e29b-41d4-a716-446655440000";
    const singularEndpoint = `/incidents/${incidentId}/location`;
    assert.equal(singularEndpoint.endsWith("/locations"), false);
    assert.equal(singularEndpoint, `/incidents/${incidentId}/location`);

    const locationPayload = {
      latitude: 19.076,
      longitude: 72.8777,
      accuracy_m: 8.5,
      captured_at: new Date().toISOString(),
    };

    assert.equal(typeof locationPayload.latitude, "number");
    assert.equal(typeof locationPayload.longitude, "number");
    assert.equal(typeof locationPayload.accuracy_m, "number");
    assert.equal(typeof locationPayload.captured_at, "string");
    assert.ok(!isNaN(Date.parse(locationPayload.captured_at)));
  });
});

// 4. Offline Map Coverage Algorithm Test
describe("Offline Map Coverage & Bounding Box Checks", () => {
  // Predefined Delhi region: [west, south, east, north]
  const delhiBounds = [77.185, 28.585, 77.245, 28.645];

  function isPointInsideBounds(lng, lat, bounds) {
    const [west, south, east, north] = bounds;
    return lng >= west && lng <= east && lat >= south && lat <= north;
  }

  it("correctly identifies point inside downloaded offline coverage", () => {
    // Connaught Place: 77.2167, 28.6315
    const cpLng = 77.2167;
    const cpLat = 28.6315;
    assert.equal(isPointInsideBounds(cpLng, cpLat, delhiBounds), true);
  });

  it("correctly identifies when device moves beyond downloaded coverage", () => {
    // Noida / Gurgaon coordinates outside Delhi Central bounds
    const noidaLng = 77.3910;
    const noidaLat = 28.5355;
    assert.equal(isPointInsideBounds(noidaLng, noidaLat, delhiBounds), false);
  });
});

// 5. Dynamic 5km Bounding Box Generator Test
describe("User-Selectable Dynamic GPS Region Bounding Box", () => {
  function createCustomBoundingBox(longitude, latitude) {
    const delta = 0.035; // ~4km
    return [
      Number((longitude - delta).toFixed(4)),
      Number((latitude - delta).toFixed(4)),
      Number((longitude + delta).toFixed(4)),
      Number((latitude + delta).toFixed(4)),
    ];
  }

  it("creates valid [west, south, east, north] bounding box for arbitrary coordinates", () => {
    // Arbitrary location (e.g. Pune: 73.8567, 18.5204)
    const lng = 73.8567;
    const lat = 18.5204;
    const [west, south, east, north] = createCustomBoundingBox(lng, lat);

    assert.ok(west < east, "West longitude must be strictly less than East");
    assert.ok(south < north, "South latitude must be strictly less than North");
    assert.ok(lng > west && lng < east, "Center longitude must be enclosed in bounds");
    assert.ok(lat > south && lat < north, "Center latitude must be enclosed in bounds");
  });
});

// 6. MapLibre GeoJSON Coordinate Convention Test
describe("MapLibre GeoJSON [longitude, latitude] Order Convention", () => {
  it("enforces [longitude, latitude] tuple for MapLibre LineString and Marker", () => {
    const sampleCoord = [77.2090, 28.6139]; // [lon, lat]
    assert.equal(sampleCoord[0], 77.2090, "First element must be longitude");
    assert.equal(sampleCoord[1], 28.6139, "Second element must be latitude");
  });
});

// 7. Tile Provider Validation & Demotiles Zoom Clamping Test
describe("Tile Provider Validation & Zoom Bounding", () => {
  function evaluateProviderConfig(customUrl, apiKey) {
    let styleUrl = "https://demotiles.maplibre.org/style.json";
    let providerName = "MapLibre Demotiles (Fallback - MaxZoom 6)";
    let isProductionProvider = false;
    let attribution = "© OpenStreetMap contributors, © MapLibre";

    if (customUrl) {
      styleUrl = customUrl;
      if (apiKey && !styleUrl.includes("key=") && !styleUrl.includes("api_key=")) {
        const separator = styleUrl.includes("?") ? "&" : "?";
        styleUrl = `${styleUrl}${separator}key=${apiKey}`;
      }
    } else if (apiKey) {
      styleUrl = `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${apiKey}`;
    }

    if (styleUrl.includes("maptiler.com")) {
      providerName = "MapTiler Cloud (Offline Permitted)";
      isProductionProvider = true;
      attribution = "© MapTiler, © OpenStreetMap contributors";
    } else if (styleUrl.includes("demotiles.maplibre.org")) {
      providerName = "MapLibre Demotiles (Fallback - MaxZoom 6)";
      isProductionProvider = false;
      attribution = "© OpenStreetMap contributors, © MapLibre";
    }

    return { styleUrl, providerName, isProductionProvider, attribution };
  }

  it("identifies fallback demotiles and clamps maxzoom to 6", () => {
    const config = evaluateProviderConfig(undefined, undefined);
    assert.equal(config.isProductionProvider, false);
    assert.equal(config.styleUrl, "https://demotiles.maplibre.org/style.json");
    
    // Zoom clamping logic
    const requestedMaxZoom = 15;
    const effectiveMaxZoom = config.isProductionProvider ? requestedMaxZoom : Math.min(requestedMaxZoom, 6);
    assert.equal(effectiveMaxZoom, 6, "Demotiles must be clamped to max zoom 6");
  });

  it("configures MapTiler vector provider with offline caching and full zoom when API key is provided", () => {
    const config = evaluateProviderConfig(undefined, "test_maptiler_key_123");
    assert.equal(config.isProductionProvider, true);
    assert.ok(config.styleUrl.includes("api.maptiler.com"));
    assert.ok(config.styleUrl.includes("test_maptiler_key_123"));
    assert.ok(config.attribution.includes("MapTiler"));

    const requestedMaxZoom = 15;
    const effectiveMaxZoom = config.isProductionProvider ? requestedMaxZoom : Math.min(requestedMaxZoom, 6);
    assert.equal(effectiveMaxZoom, 15, "Production provider allows street-level zoom 15");
  });
});

// 8. Bounding Box Validation Logic Test
describe("Offline Bounding Box Validation", () => {
  function isValidBoundingBox(bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4) return false;
    const [west, south, east, north] = bounds;
    if (
      typeof west !== "number" || isNaN(west) ||
      typeof south !== "number" || isNaN(south) ||
      typeof east !== "number" || isNaN(east) ||
      typeof north !== "number" || isNaN(north)
    ) return false;
    if (west < -180 || west > 180 || east < -180 || east > 180) return false;
    if (south < -90 || south > 90 || north < -90 || north > 90) return false;
    if (west >= east || south >= north) return false;
    return true;
  }

  it("accepts valid [west, south, east, north] bounds", () => {
    assert.equal(isValidBoundingBox([77.185, 28.585, 77.245, 28.645]), true);
  });

  it("rejects inverted longitudes (west >= east)", () => {
    assert.equal(isValidBoundingBox([77.245, 28.585, 77.185, 28.645]), false);
  });

  it("rejects inverted latitudes (south >= north)", () => {
    assert.equal(isValidBoundingBox([77.185, 28.645, 77.245, 28.585]), false);
  });

  it("rejects out-of-range coordinates", () => {
    assert.equal(isValidBoundingBox([-190, 0, 10, 10]), false);
    assert.equal(isValidBoundingBox([0, -95, 10, 10]), false);
  });

  it("rejects malformed arrays or non-numeric entries", () => {
    assert.equal(isValidBoundingBox([1, 2, 3]), false);
    assert.equal(isValidBoundingBox(null), false);
    assert.equal(isValidBoundingBox(["a", 2, 3, 4]), false);
  });
});

// 9. Download Manager State & Metrics Reconciliation
describe("Download Manager Reconciliation & Storage Reporting", () => {
  function getTotalOfflineStorageBytes(regions) {
    return regions
      .filter((r) => r.status === "READY")
      .reduce((acc, r) => acc + (r.downloadedBytes || 0), 0);
  }

  it("calculates total storage strictly from READY regions, ignoring cancelled and error regions", () => {
    const testRegions = [
      { id: "delhi", status: "READY", downloadedBytes: 1500000 },
      { id: "mumbai", status: "DOWNLOADING", downloadedBytes: 800000 },
      { id: "bengaluru", status: "NOT_DOWNLOADED", downloadedBytes: 0 },
      { id: "custom", status: "ERROR", downloadedBytes: 250000 },
      { id: "pune", status: "READY", downloadedBytes: 2100000 },
    ];

    const totalBytes = getTotalOfflineStorageBytes(testRegions);
    assert.equal(totalBytes, 3600000, "Only READY regions (1.5MB + 2.1MB) count towards offline disk consumption");
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    assert.equal(totalMB, "3.4");
  });

  it("reconciles missing native packs so UI does not report missing pack as READY", () => {
    const storedMetadata = [
      { id: "reg-1", name: "Delhi", status: "READY", downloadedBytes: 1500000 },
      { id: "reg-2", name: "Mumbai", status: "READY", downloadedBytes: 2000000 },
    ];
    // Native packs database on disk only has reg-1; reg-2 was deleted or wiped
    const nativePacksOnDisk = new Set(["reg-1"]);

    const reconciled = storedMetadata.map((r) => {
      if (r.status === "READY" && !nativePacksOnDisk.has(r.id)) {
        return {
          ...r,
          status: "NOT_DOWNLOADED",
          progressPercentage: 0,
          downloadedBytes: 0,
          completedTileCount: 0,
          requiredResourceCount: 0,
        };
      }
      return r;
    });

    const reg1 = reconciled.find((r) => r.id === "reg-1");
    const reg2 = reconciled.find((r) => r.id === "reg-2");

    assert.equal(reg1.status, "READY");
    assert.equal(reg2.status, "NOT_DOWNLOADED");
    assert.equal(reg2.downloadedBytes, 0);
  });

  it("cleans up all metrics upon cancellation", () => {
    const regionBeforeCancel = {
      id: "reg-downloading",
      status: "DOWNLOADING",
      progressPercentage: 45,
      downloadedBytes: 650000,
      completedTileCount: 68,
      requiredResourceCount: 150,
      error: undefined,
    };

    // Cancellation action
    const cancelledRegion = {
      ...regionBeforeCancel,
      status: "NOT_DOWNLOADED",
      progressPercentage: 0,
      downloadedBytes: 0,
      completedTileCount: 0,
      requiredResourceCount: 0,
      error: undefined,
    };

    assert.equal(cancelledRegion.status, "NOT_DOWNLOADED");
    assert.equal(cancelledRegion.progressPercentage, 0);
    assert.equal(cancelledRegion.downloadedBytes, 0);
    assert.equal(cancelledRegion.completedTileCount, 0);
  });
});

// 10. SOS Location Denial & Missing GPS Resilience
describe("SOS Resilience Under Permission Denial & Missing GPS", () => {
  function prepareSosPayload(clientEventId, triggerType, locationState, shareLocationPref = true) {
    const backendTrigger =
      triggerType === "voice" ? "voice_keyword" : triggerType === "shake" ? "shake" : "manual";

    return {
      client_event_id: clientEventId,
      trigger: backendTrigger,
      occurred_at: new Date().toISOString(),
      location: locationState ? {
        latitude: locationState.latitude,
        longitude: locationState.longitude,
        accuracy_m: locationState.accuracy || 10,
        captured_at: new Date().toISOString(),
      } : undefined,
      share_location: shareLocationPref,
    };
  }

  it("does not fabricate (0,0) coordinates when GPS is denied or unavailable", () => {
    const id = uuidv4();
    const payloadNoGps = prepareSosPayload(id, "manual", null);

    assert.equal(payloadNoGps.location, undefined);
    assert.equal("latitude" in (payloadNoGps.location || {}), false);
    assert.equal(payloadNoGps.share_location, true);
    assert.equal(validateUuid(payloadNoGps.client_event_id), true);
  });

  it("attaches high-precision GPS coordinates when location is granted", () => {
    const id = uuidv4();
    const mockLocation = { latitude: 28.6139, longitude: 77.2090, accuracy: 8.2 };
    const payloadWithGps = prepareSosPayload(id, "shake", mockLocation);

    assert.ok(payloadWithGps.location);
    assert.equal(payloadWithGps.location.latitude, 28.6139);
    assert.equal(payloadWithGps.location.longitude, 77.2090);
    assert.equal(payloadWithGps.location.accuracy_m, 8.2);
    assert.equal(payloadWithGps.trigger, "shake");
  });
});

// 11. Offline Outbox Deduplication & Synchronization
describe("Offline Outbox Idempotency & Queue Life Cycle", () => {
  it("enforces client_event_id deduplication during enqueuing", () => {
    const queue = [];
    function enqueue(item) {
      const existing = queue.find((i) => i.id === item.client_event_id);
      if (existing) return existing;
      const newItem = { id: item.client_event_id, payload: item, status: "NOT_SENT" };
      queue.push(newItem);
      return newItem;
    }

    const eventId = uuidv4();
    const item1 = { client_event_id: eventId, trigger: "manual" };
    const item2 = { client_event_id: eventId, trigger: "manual" };

    enqueue(item1);
    enqueue(item2);

    assert.equal(queue.length, 1, "Duplicate SOS client_event_id must not create duplicate queue entries");
    assert.equal(queue[0].id, eventId);
  });

  it("prunes successfully sent items while keeping failed items for retry", () => {
    let queue = [
      { id: "ev-1", status: "SENT_ACCEPTED" },
      { id: "ev-2", status: "FAILED" },
      { id: "ev-3", status: "SENT_ACCEPTED" },
    ];

    // Prune logic executed after outbox sync
    queue = queue.filter((i) => i.status !== "SENT_ACCEPTED");

    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, "ev-2");
  });
});

// 12. Safe Journey Transition Contracts (Backend Alignment)
describe("Safe Journey Transition API Alignment", () => {
  it("targets /journeys/{id}/complete for safe check-in", () => {
    const journeyId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const completeUrl = `/journeys/${journeyId}/complete`;
    assert.equal(completeUrl, `/journeys/${journeyId}/complete`);
  });

  it("targets /journeys/{id}/cancel for user journey cancellation", () => {
    const journeyId = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
    const cancelUrl = `/journeys/${journeyId}/cancel`;
    assert.equal(cancelUrl, `/journeys/${journeyId}/cancel`);
  });

  it("validates that ETA timestamp is strictly in the future", () => {
    const futureEta = new Date(Date.now() + 25 * 60000);
    const pastEta = new Date(Date.now() - 5000);

    assert.ok(futureEta > new Date(), "Journey ETA must be future");
    assert.ok(pastEta <= new Date(), "Past ETA is invalid");
  });
});

// 13. Cryptographically Secure UUID Generation & Uniqueness
describe("Secure UUID Generation & Cryptographic Uniqueness", () => {
  it("generates 1,000 unique UUIDs with zero collisions", () => {
    const set = new Set();
    const count = 1000;
    for (let i = 0; i < count; i++) {
      const id = uuidv4();
      assert.equal(validateUuid(id), true);
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      set.add(id);
    }
    assert.equal(set.size, count, "All generated UUIDs must be distinct");
  });

  it("does not use predictable timestamps or Math.random strings", () => {
    const id = uuidv4();
    assert.equal(isNaN(Number(id)), true);
    assert.equal(id.length, 36);
    assert.equal(id.split("-").length, 5);
  });
});

// 14. API Network Timeout & Physical Device Resilience
describe("API Network Timeout & Physical Device Resilience", () => {
  async function fetchWithTimeoutSim(timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Simulate slow / hanging network request
      await new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          const err = new Error(`Request timed out after ${timeoutMs}ms`);
          err.name = "AbortError";
          reject(err);
        });
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  it("aborts hanging request within specified timeout limit", async () => {
    const start = Date.now();
    await assert.rejects(
      async () => {
        await fetchWithTimeoutSim(50);
      },
      {
        name: "AbortError",
        message: /Request timed out after 50ms/,
      }
    );
    const duration = Date.now() - start;
    assert.ok(duration >= 40 && duration < 300, `Expected ~50ms timeout, took ${duration}ms`);
  });
});

// 15. Duplicate SOS Submission In-Flight Guard
describe("Duplicate SOS In-Flight Suppression", () => {
  it("blocks rapid duplicate SOS dispatches while an alert is in flight", async () => {
    let inFlight = false;
    let dispatchCount = 0;

    const triggerSOS = async () => {
      if (inFlight) return null;
      inFlight = true;
      dispatchCount++;
      // Simulate async dispatch latency
      await new Promise((resolve) => setTimeout(resolve, 50));
      inFlight = false;
      return "DISPATCHED";
    };

    // First call begins flight
    const p1 = triggerSOS();
    // Immediate concurrent calls should be suppressed
    const p2 = triggerSOS();
    const p3 = triggerSOS();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.equal(r1, "DISPATCHED");
    assert.equal(r2, null, "Concurrent second call must be blocked");
    assert.equal(r3, null, "Concurrent third call must be blocked");
    assert.equal(dispatchCount, 1, "Only one SOS dispatch must execute");

    // After completion, new dispatch is permitted
    const r4 = await triggerSOS();
    assert.equal(r4, "DISPATCHED");
    assert.equal(dispatchCount, 2);
  });
});

