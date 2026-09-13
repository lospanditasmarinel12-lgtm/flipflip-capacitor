// WebBluetoothPolyfill.ts
// Polyfills navigator.bluetooth on top of @capacitor-community/bluetooth-le
// so the Buttplug WASM server (buttplug-wasm-blob) works on Capacitor
// (Android + iOS) without Intiface Central — no per-device drivers required.
//
// It implements the standard Web Bluetooth API surface the WASM server uses:
//   navigator.bluetooth.requestDevice/getAvailability/getDevices
//   BluetoothDevice { id, name, gatt, watchAdvertisements, addEventListener }
//   BluetoothRemoteGATTServer { connected, connect, disconnect, getPrimaryService(s) }
//   BluetoothRemoteGATTService { device, uuid, isPrimary, getCharacteristic(s) }
//   BluetoothRemoteGATTCharacteristic extends EventTarget {
//     uuid, properties, value, readValue, writeValue, writeValueWithoutResponse,
//     startNotifications, stopNotifications,
//     addEventListener("characteristicvaluechanged"), oncharacteristicvaluechanged
//   }
//   Device "gattserverdisconnected" events.

import { BleClient } from '@capacitor-community/bluetooth-le';
import { isLogEnabled } from '../logging';

interface BleCharacteristicDef {
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  properties: any;
}

interface BleServiceDef {
  deviceId: string;
  uuid: string;
  characteristics: BleCharacteristicDef[];
}

const blc = (...args: any[]) => { if (isLogEnabled('ble')) console.log('[BLEC]', ...args); };

// ---------------------------------------------------------------------------
// Minimal EventTarget for the polyfill objects (characteristics/services/devices)
// ---------------------------------------------------------------------------

interface PolyfillEventListener {
  (evt: any): void;
}

class PolyfillEventTarget {
  private _listeners: Map<string, Set<PolyfillEventListener>> = new Map();

  addEventListener(type: string, callback: PolyfillEventListener | null, _useCapture?: boolean): void {
    if (typeof callback !== 'function') return;
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(callback);
  }

  removeEventListener(type: string, callback: PolyfillEventListener | null, _useCapture?: boolean): void {
    this._listeners.get(type)?.delete(callback);
  }

  dispatchEvent(event: any): boolean {
    const listeners = this._listeners.get(event?.type);
    if (listeners) {
      for (const cb of Array.from(listeners)) {
        try { cb.call(event?.target ?? this, event); } catch (e) { console.warn('[BLEC] listener error:', e); }
      }
    }
    return true;
  }
}

/** Normalize any BufferSource (ArrayBuffer / TypedArray / DataView) to a DataView. */
function toDataView(value: any): DataView {
  if (value instanceof DataView) return value;
  if (ArrayBuffer.isView(value)) {
    const typed = value as Uint8Array;
    return new DataView(typed.buffer, typed.byteOffset, typed.byteLength);
  }
  if (value instanceof ArrayBuffer) return new DataView(value);
  throw new TypeError('Expected BufferSource for GATT value');
}

function uuidEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

// ---------------------------------------------------------------------------
// Characteristic
// ---------------------------------------------------------------------------

class PolyfillBluetoothRemoteGATTCharacteristic extends PolyfillEventTarget {
  deviceId: string;
  serviceUuid: string;
  uuid: string;
  properties: any;
  value: DataView | null = null;
  service!: PolyfillBluetoothRemoteGATTService;
  private _notifySubscribed = false;
  private _legacyHandler: any = null;
  private _notifyBuffer: DataView[] = [];

  get oncharacteristicvaluechanged(): any {
    return this._legacyHandler;
  }

  set oncharacteristicvaluechanged(fn: any) {
    this._legacyHandler = fn;
    this._flushNotifyBuffer();
  }

  constructor(def: BleCharacteristicDef, service: PolyfillBluetoothRemoteGATTService) {
    super();
    this.deviceId = def.deviceId;
    this.serviceUuid = def.serviceUuid;
    this.uuid = def.characteristicUuid;
    this.properties = def.properties;
    this.service = service;
  }

  override addEventListener(type: string, callback: PolyfillEventListener | null, _useCapture?: boolean): void {
    super.addEventListener(type, callback, _useCapture);
    if (type === 'characteristicvaluechanged') {
      // The WASM server may attach its listener AFTER the first handshake
      // notification arrived — replay anything we buffered so it never misses
      // the device's initial status frame.
      this._flushNotifyBuffer();
    }
  }

  private _notify(value: DataView): void {
    this.value = value;
    const hasListener =
      (this as any)._listeners?.get('characteristicvaluechanged')?.size > 0 ||
      typeof this._legacyHandler === 'function';
    if (!hasListener) {
      this._notifyBuffer.push(value);
      if (this._notifyBuffer.length > 8) this._notifyBuffer.shift();
      return;
    }
    const event = { type: 'characteristicvaluechanged', target: this, value } as any;
    this.dispatchEvent(event);
    if (typeof this._legacyHandler === 'function') {
      try { this._legacyHandler.call(this, event); } catch (e) {}
    }
  }

  private _flushNotifyBuffer(): void {
    if (this._notifyBuffer.length === 0) return;
    const pending = this._notifyBuffer;
    this._notifyBuffer = [];
    for (const value of pending) {
      const event = { type: 'characteristicvaluechanged', target: this, value } as any;
      this.dispatchEvent(event);
      if (typeof this._legacyHandler === 'function') {
        try { this._legacyHandler.call(this, event); } catch (e) {}
      }
    }
  }

  getCharacteristic(uuid: string): Promise<PolyfillBluetoothRemoteGATTCharacteristic> {
    return this.service.getCharacteristic(uuid);
  }

  async readValue(): Promise<DataView> {
    blc('readValue', this.uuid);
    const dv = await BleClient.read(this.deviceId, this.serviceUuid, this.uuid);
    this.value = dv;
    blc('readValue -> ok', this.uuid, dv && dv.byteLength, 'bytes');
    return dv;
  }

  async writeValue(value: any): Promise<void> {
    const dv = toDataView(value);
    blc('writeValue', this.uuid, dv.byteLength, 'bytes');
    await BleClient.write(this.deviceId, this.serviceUuid, this.uuid, dv);
    blc('writeValue -> ok', this.uuid);
  }

  async writeValueWithoutResponse(value: any): Promise<void> {
    const dv = toDataView(value);
    blc('writeValueWithoutResponse', this.uuid, dv.byteLength, 'bytes');
    await BleClient.writeWithoutResponse(this.deviceId, this.serviceUuid, this.uuid, dv);
    blc('writeValueWithoutResponse -> ok', this.uuid);
  }

  async startNotifications(): Promise<PolyfillBluetoothRemoteGATTCharacteristic> {
    if (this._notifySubscribed) return this;
    blc('startNotifications', this.uuid);
    await BleClient.startNotifications(
      this.deviceId,
      this.serviceUuid,
      this.uuid,
      (value: DataView) => {
        if (isLogEnabled('ble') && Math.random() < 0.2) {
          // Only log a short preview — notify traffic can be very chatty.
          console.log('[BLEC] notify', this.uuid, value && value.byteLength, 'bytes');
        }
        this._notify(value);
      }
    );
    this._notifySubscribed = true;
    blc('startNotifications -> ok', this.uuid);
    return this;
  }

  async stopNotifications(): Promise<PolyfillBluetoothRemoteGATTCharacteristic> {
    if (this._notifySubscribed) {
      blc('stopNotifications', this.uuid);
      try { await BleClient.stopNotifications(this.deviceId, this.serviceUuid, this.uuid); } catch (e) {}
      this._notifySubscribed = false;
    }
    return this;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class PolyfillBluetoothRemoteGATTService extends PolyfillEventTarget {
  deviceId: string;
  uuid: string;
  isPrimary = true;
  device?: PolyfillBluetoothDevice;
  private characteristics: PolyfillBluetoothRemoteGATTCharacteristic[] = [];

  constructor(def: BleServiceDef, device?: PolyfillBluetoothDevice) {
    super();
    this.deviceId = def.deviceId;
    this.uuid = def.uuid;
    this.device = device;
    this.characteristics = def.characteristics.map((c) => {
      const ch = new PolyfillBluetoothRemoteGATTCharacteristic(c, this);
      return ch;
    });
  }

  async getCharacteristic(uuid: string): Promise<PolyfillBluetoothRemoteGATTCharacteristic> {
    const ch = this.characteristics.find((c) => uuidEquals(c.uuid, uuid));
    if (ch) return ch;
    const list = await this.getCharacteristics(uuid);
    if (list.length > 0) return list[0];
    throw new Error(`Characteristic ${uuid} not found`);
  }

  async getCharacteristics(uuid?: string): Promise<PolyfillBluetoothRemoteGATTCharacteristic[]> {
    if (uuid) {
      return this.characteristics.filter((c) => uuidEquals(c.uuid, uuid));
    }
    return this.characteristics;
  }

  async getIncludedService(service: string): Promise<PolyfillBluetoothRemoteGATTService | null> {
    blc('getIncludedService (unused)', service);
    return null;
  }

  async getIncludedServices(service?: string): Promise<PolyfillBluetoothRemoteGATTService[]> {
    blc('getIncludedServices (unused)', service);
    return [];
  }
}

// ---------------------------------------------------------------------------
// GATT Server
// ---------------------------------------------------------------------------

class PolyfillBluetoothRemoteGATTServer extends PolyfillEventTarget {
  deviceId: string;
  device?: PolyfillBluetoothDevice;
  private services: PolyfillBluetoothRemoteGATTService[] = [];
  private _connected = false;

  constructor(deviceId: string, device?: PolyfillBluetoothDevice) {
    super();
    this.deviceId = deviceId;
    this.device = device;
  }

  get connected(): boolean {
    return this._connected;
  }

  setConnected(v: boolean): void {
    this._connected = v;
  }

  async connect(): Promise<PolyfillBluetoothRemoteGATTServer> {
    // Short-circuit: the WASM server calls gatt.connect() repeatedly. Don't
    // re-connect / re-discover services on an already-connected, cached server.
    if (this._connected && this.services.length > 0) return this;

    blc('gatt.connect', this.deviceId);
    await BleClient.connect(this.deviceId, (deviceId: string) => {
      // Native disconnect -> notify the WASM so it can tear down cleanly.
      blc('native disconnect', deviceId);
      this.setConnected(false);
      if (this.device) {
        this.device.dispatchEvent({ type: 'gattserverdisconnected', target: this.device });
      }
    });
    this.setConnected(true);

    if (this.services.length === 0) {
      const bleServices = await BleClient.getServices(this.deviceId);
      this.services = bleServices.map((s) => new PolyfillBluetoothRemoteGATTService({
        deviceId: this.deviceId,
        uuid: s.uuid,
        characteristics: s.characteristics.map((c) => ({
          deviceId: this.deviceId,
          serviceUuid: s.uuid,
          characteristicUuid: c.uuid,
          properties: c.properties,
        })),
      }, this.device));
      blc('gatt.connect -> services', this.deviceId, this.services.length);
    }
    return this;
  }

  async getPrimaryService(uuid: string): Promise<PolyfillBluetoothRemoteGATTService> {
    const svc = this.services.find((s) => uuidEquals(s.uuid, uuid));
    if (svc) return svc;
    throw new Error(`Service ${uuid} not found`);
  }

  async getPrimaryServices(uuid?: string): Promise<PolyfillBluetoothRemoteGATTService[]> {
    if (uuid) {
      return this.services.filter((s) => uuidEquals(s.uuid, uuid));
    }
    return this.services;
  }

  disconnect(): void {
    if (this._connected) {
      blc('gatt.disconnect', this.deviceId);
      this.setConnected(false);
      BleClient.disconnect(this.deviceId).catch(() => {});
      if (this.device) {
        this.device.dispatchEvent({ type: 'gattserverdisconnected', target: this.device });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

class PolyfillBluetoothDevice extends PolyfillEventTarget {
  id: string;
  name: string;
  gatt: PolyfillBluetoothRemoteGATTServer;

  constructor(device: { deviceId: string; name?: string }) {
    super();
    this.id = device.deviceId;
    this.name = device.name || 'Unknown Device';
    this.gatt = new PolyfillBluetoothRemoteGATTServer(this.id, this);
  }

  async watchAdvertisements(): Promise<void> {
    // Not needed by the Buttplug WASM server; provide a no-op that resolves.
    return;
  }
}

// ---------------------------------------------------------------------------
// Bluetooth singleton + device selection
// ---------------------------------------------------------------------------

export interface PolyfilledBluetooth {
  requestDevice(options?: { filters?: Array<{ services: string[] } | null>; optionalServices?: string[]; acceptAllDevices?: boolean }): Promise<PolyfillBluetoothDevice>;
  getAvailability(): Promise<boolean>;
  getDevices(): Promise<PolyfillBluetoothDevice[]>;
}

let _autoConnected: PolyfillBluetoothDevice | null = null;
let _autoScanInFlight: Promise<PolyfillBluetoothDevice> | null = null;

/** The device auto-connected by the polyfill (if any) — lets the app's haptics
 *  UI surface the toy even when the WASM server event is missed. */
export function getAutoConnectedDevice(): PolyfillBluetoothDevice | null {
  return _autoConnected;
}

/**
 * Auto-select a toy without the iOS system picker: background-scan with the
 * requested service filter, connect the first advertising match, and resolve
 * like a Web Bluetooth requestDevice. This is the mobile analog of the
 * desktop's automatic device selection.
 */
async function autoSelectDevice(options?: { filters?: Array<{ services: string[] } | null>; optionalServices?: string[]; acceptAllDevices?: boolean }): Promise<PolyfillBluetoothDevice> {
  if (_autoConnected) return _autoConnected;

  // Merge the request filter's services WITH optionalServices into the scan
  // filter (the WASM server typically requests filterless via optionalServices).
  const merged = Array.from(new Set([
    ...(options?.filters?.[0]?.services ?? []),
    ...(options?.optionalServices ?? []),
  ])).map((u) => String(u).toLowerCase());

  await BleClient.initialize();

  let done = false;
  const stop = async () => {
    if (done) return;
    done = true;
    try { await BleClient.stopLEScan(); } catch (e) {}
  };

  return new Promise<PolyfillBluetoothDevice>((resolve, reject) => {
    const settle = async (deviceId: string, name?: string) => {
      if (done) return;
      await stop();
      try {
        await BleClient.connect(deviceId, () => {});
      } catch (err) {
        _autoConnected = null;
        reject(err);
        return;
      }
      const dev = new PolyfillBluetoothDevice({ deviceId, name });
      dev.gatt.setConnected(true);
      _autoConnected = dev;
      blc('auto-connected', name, deviceId);
      resolve(dev);
    };

    const timer = setTimeout(() => {
      (async () => {
        await stop();
        reject(new Error('requestDevice cancelled: no matching Bluetooth device found'));
      })();
    }, 25000);

    BleClient.requestLEScan(
      { services: merged, allowDuplicates: false },
      (result: any) => {
        if (done) return;
        const deviceId: string = result?.device?.deviceId;
        if (!deviceId) return;
        const name: string = result?.localName || result?.device?.name || '';
        const uuids: string[] = (result?.uuids ?? []).map((u: any) => String(u).toLowerCase());
        const matches = merged.length === 0 || uuids.some((u: string) => merged.includes(u));
        if (!matches) return;
        clearTimeout(timer);
        settle(deviceId, name).catch((err) => {
          (async () => {
            await stop();
            reject(err);
          })();
        });
      }
    ).catch((err) => {
      clearTimeout(timer);
      (async () => {
        await stop();
        reject(err);
      })();
    });
  });
}

export async function installWebBluetoothPolyfill(): Promise<void> {
  if ((navigator as any).bluetooth && typeof (navigator as any).bluetooth.requestDevice === 'function') {
    // Native Web Bluetooth is available (Chromium), no polyfill needed
    return;
  }

  // Initialize the native BLE stack FIRST. Without this, getAvailability() →
  // BleClient.isEnabled() rejects with "Bluetooth LE not initialized".
  try {
    await BleClient.initialize();
  } catch (e) {
    console.warn('[Haptics] BleClient.initialize() failed during polyfill install:', e);
  }

  const polyfill: PolyfilledBluetooth = {
    async requestDevice(options) {
      // Serialize concurrent requestDevice calls (the WASM server may issue
      // several) so only one silent scan runs; once connected, later calls
      // return the already-connected device immediately.
      if (_autoScanInFlight) return _autoScanInFlight;
      _autoScanInFlight = autoSelectDevice(options).finally(() => { _autoScanInFlight = null; });
      return _autoScanInFlight;
    },
    async getAvailability() {
      try {
        return await BleClient.isEnabled();
      } catch {
        // Retry once: the native stack may not have been initialized yet on
        // some launch orderings.
        try {
          await BleClient.initialize();
          return await BleClient.isEnabled();
        } catch {
          return false;
        }
      }
    },
    async getDevices() {
      return _autoConnected ? [_autoConnected] : [];
    },
  };

  (navigator as any).bluetooth = polyfill;
  console.log('[Haptics] Web Bluetooth polyfill installed via @capacitor-community/bluetooth-le');
}
