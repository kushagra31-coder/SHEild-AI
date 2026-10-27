import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { createIncidentAPI, CreateIncidentPayload, IncidentResponse } from "./api";

export type OutboxStatus = "NOT_SENT" | "PENDING" | "SENT_ACCEPTED" | "FAILED";

export interface OutboxItem {
  id: string;
  payload: CreateIncidentPayload;
  queued_at: string;
  retry_count: number;
  status: OutboxStatus;
  last_error?: string;
  last_attempt_at?: string;
}

const STORAGE_KEY = "SHEILD_OFFLINE_OUTBOX_V1";

const getDocDir = (): string => {
  try {
    return (FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory || "";
  } catch (e) {
    return "";
  }
};

async function readStorage(): Promise<OutboxItem[]> {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      }
    } else {
      const docDir = getDocDir();
      if (docDir) {
        const filePath = `${docDir}sheild_offline_outbox_v1.json`;
        const getInfo = (FileSystem as any).getInfoAsync;
        const readStr = (FileSystem as any).readAsStringAsync;
        if (getInfo && readStr) {
          const info = await getInfo(filePath);
          if (info && info.exists) {
            const raw = await readStr(filePath);
            if (raw) return JSON.parse(raw);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[OfflineOutbox] Failed reading storage, defaulting to empty queue:", err);
  }
  return [];
}

async function writeStorage(queue: OutboxItem[]): Promise<void> {
  try {
    const json = JSON.stringify(queue);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, json);
      }
    } else {
      const docDir = getDocDir();
      if (docDir) {
        const filePath = `${docDir}sheild_offline_outbox_v1.json`;
        const writeStr = (FileSystem as any).writeAsStringAsync;
        if (writeStr) {
          await writeStr(filePath, json);
        }
      }
    }
  } catch (err) {
    console.warn("[OfflineOutbox] Failed writing storage:", err);
  }
}

class OfflineOutbox {
  private queue: OutboxItem[] = [];
  private isLoaded: boolean = false;
  private isSyncing: boolean = false;

  constructor() {
    this.init();
  }

  public async init(): Promise<OutboxItem[]> {
    if (this.isLoaded) return this.queue;
    this.queue = await readStorage();
    this.isLoaded = true;
    return this.queue;
  }

  public async enqueue(payload: CreateIncidentPayload): Promise<OutboxItem> {
    await this.init();
    
    // Preserve client_event_id idempotency
    const existing = this.queue.find(i => i.id === payload.client_event_id);
    if (existing) {
      return existing;
    }

    const item: OutboxItem = {
      id: payload.client_event_id,
      payload,
      queued_at: new Date().toISOString(),
      retry_count: 0,
      status: "NOT_SENT"
    };

    this.queue.push(item);
    await writeStorage(this.queue);
    return item;
  }

  public async getPending(): Promise<OutboxItem[]> {
    await this.init();
    return this.queue.filter(i => i.status !== "SENT_ACCEPTED");
  }

  public async getAll(): Promise<OutboxItem[]> {
    await this.init();
    return this.queue;
  }

  public async clear(): Promise<void> {
    this.queue = [];
    await writeStorage(this.queue);
  }

  public async sync(): Promise<{ synced: IncidentResponse[]; failedCount: number }> {
    await this.init();

    if (this.isSyncing) {
      return { synced: [], failedCount: this.queue.filter(i => i.status !== "SENT_ACCEPTED").length };
    }

    this.isSyncing = true;
    const synced: IncidentResponse[] = [];

    for (const item of this.queue) {
      if (item.status === "SENT_ACCEPTED") {
        continue;
      }

      item.status = "PENDING";
      item.last_attempt_at = new Date().toISOString();
      item.retry_count += 1;
      await writeStorage(this.queue);

      try {
        const res = await createIncidentAPI(item.payload);
        if (res) {
          item.status = "SENT_ACCEPTED";
          synced.push(res);
        } else {
          item.status = "FAILED";
          item.last_error = "Server unavailable or network request failed";
        }
      } catch (err: any) {
        item.status = "FAILED";
        item.last_error = err?.message || "Network execution exception";
      }
    }

    // Prune successfully sent items from persistent queue to keep it clean
    this.queue = this.queue.filter(i => i.status !== "SENT_ACCEPTED");
    await writeStorage(this.queue);
    this.isSyncing = false;

    return { synced, failedCount: this.queue.length };
  }
}

export const offlineOutbox = new OfflineOutbox();
