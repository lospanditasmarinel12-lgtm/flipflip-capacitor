import * as path from "../services/path";
import * as easings from 'd3-ease';
import "core-js/features/array/flat";

import {getFileGroup, getSourceType} from "../components/player/Scrapers";
import {BT, EA, GO, HTF, IF, IT, OF, OT, SC, SL, SOF, ST, STF, TF, TT, VO, VTF, WF} from "./const";
import en from "./en";
import Config from "./Config";
import LibrarySource from "./LibrarySource";
import Audio from "./Audio";
import WeightGroup from "./WeightGroup";
import Scene from "./Scene";
import Clip from "./Clip";
import { getFilesystem } from "../services/filesystem";
import { isCapacitor } from "../services/platform";
import { rememberPath } from "../services/local-paths";
import { saveDir, savePath } from "../services/app-paths";

export { saveDir, savePath };

// Only read+decode a full audio file for its duration when it fits in this
// budget; anything larger would OOM the WebView/native bridge on mobile.
const MAX_DURATION_DECODE_BYTES = 25 * 1024 * 1024;

export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

export function flatten(array: Array<any>) {
  return array.flat();
}

export function getEaseFunction(ea: string, exp: number, amp: number, per: number, ov: number) {
  switch(ea) {
    case EA.linear:
      return easings.easeLinear;
    case EA.sinIn:
      return easings.easeSinIn;
    case EA.sinOut:
      return easings.easeSinOut;
    case EA.sinInOut:
      return easings.easeSinInOut;
    case EA.expIn:
      return easings.easeExpIn;
    case EA.expOut:
      return easings.easeExpOut;
    case EA.expInOut:
      return easings.easeExpInOut;
    case EA.circleIn:
      return easings.easeCircleIn;
    case EA.circleOut:
      return easings.easeCircleOut;
    case EA.circleInOut:
      return easings.easeCircleInOut;
    case EA.bounceIn:
      return easings.easeBounceIn;
    case EA.bounceOut:
      return easings.easeBounceOut;
    case EA.bounceInOut:
      return easings.easeBounceInOut;
    case EA.polyIn:
      return easings.easePolyIn.exponent(exp);
    case EA.polyOut:
      return easings.easePolyOut.exponent(exp);
    case EA.polyInOut:
      return easings.easePolyInOut.exponent(exp);
    case EA.elasticIn:
      return easings.easeElasticIn.amplitude(amp).period(per);
    case EA.elasticOut:
      return easings.easeElasticOut.amplitude(amp).period(per);
    case EA.elasticInOut:
      return easings.easeElasticInOut.amplitude(amp).period(per);
    case EA.backIn:
      return easings.easeBackIn.overshoot(ov);
    case EA.backOut:
      return easings.easeBackOut.overshoot(ov);
    case EA.backInOut:
      return easings.easeBackInOut.overshoot(ov);

  }
}

export async function getBackups(): Promise<Array<{url: string, size: number}>> {
  try {
    const fs = getFilesystem();
    const entries = await fs.readDirectory("flipflip");
    const backups = entries
      .filter((e) => e.name.startsWith("data.json.") && e.name != "data.json.new")
      .map((e) => ({url: e.name, size: e.size}));
    backups.sort((a, b) => {
      if (a.url > b.url) return -1;
      if (a.url < b.url) return 1;
      return 0;
    });
    return backups;
  } catch {
    return [];
  }
}

export function convertFromEpoch(backupFile: string) {
  const epochString = backupFile.substring(backupFile.lastIndexOf(".") + 1);
  const date = new Date(Number.parseInt(epochString));
  return date.toLocaleString();
}

export function getTimingFromString(tf: string): string {
  switch(tf) {
    case "constant":
    case "const":
      return TF.constant;
    case "random":
    case "rand":
      return  TF.random;
    case "wave":
    case "sin":
      return  TF.sin;
    case "bpm":
    case "audio":
      return  TF.bpm;
    case "scene":
      return  TF.scene;
    default:
      return null;
  }
}

export function getTimeout(tf: string, c: number, min: number, max: number, sinRate: number,
                           audio: Audio, bpmMulti: number, timeToNextFrame: number): number {
  let timeout = null;
  switch (tf) {
    case TF.random:
      timeout = Math.floor(Math.random() * (max - min + 1)) + min;
      break;
    case TF.sin:
      sinRate = (Math.abs(sinRate - 100) + 2) * 1000;
      timeout = Math.floor(Math.abs(Math.sin(Date.now() / sinRate)) * (max - min + 1)) + min;
      break;
    case TF.constant:
      timeout = c;
      break;
    case TF.bpm:
      if (!audio) {
        timeout = 1000;
      } else {
        timeout = 60000 / (audio.bpm * bpmMulti);
        // If we cannot parse this, default to 1s
        if (!timeout) {
          timeout = 1000;
        }
      }
      break;
    case TF.scene:
      timeout = timeToNextFrame ? timeToNextFrame : 1000;
      break;
  }
  return timeout;
}

export function getTimestamp(secs: number): string {
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor(secs % 3600 / 60);
  const seconds = Math.floor(secs % 3600 % 60);
  if (hours > 0) {
    return hours + ":" + (minutes >= 10 ? minutes : "0" + minutes) + ":" + (seconds >= 10 ? seconds : "0" + seconds);
  } else {
    return minutes + ":" + (seconds >= 10 ? seconds : "0" + seconds);
  }
}

export function getMsRemainder(sec: number): string {
  if (isNaN(sec) || sec < 0) {
    return null;
  }

  const ms = Math.round(sec * 1000);
  let remainder = (Math.floor((ms % 1000) * 1000) / 1000).toString();
  while (remainder.length < 3) {
    remainder = "0" + remainder;
  }
  return "." + remainder;
}

export function getMsTimestampValue(value: string): number {
  const split = value.split(":");
  const splitInt = [];
  let milli = null;
  if (split.length > 3 || split.length == 0) return null;
  if (split[split.length - 1].includes(".")) {
    const splitMili = split[split.length - 1].split("\.");
    if (splitMili.length > 2) return null;
    split[split.length - 1] = splitMili[0];
    milli = splitMili[1];
    if (milli.length > 3) return null;
    while (milli.length < 3) {
      milli += "0";
    }
    milli = parseInt(milli);
    if (isNaN(milli)) return null;
  }
  for (let n = 0; n < split.length; n++) {
    if (n != 0) {
      if (split[n].length != 2) return null;
    }
    const int = parseInt(split[n]);
    if (isNaN(int)) return null;
    splitInt.push(int);
  }

  let ms;
  if (split.length == 3) {
    ms = (splitInt[0] * 60 * 60) + (splitInt[1] * 60) + splitInt[2];
  } else if (split.length == 2) {
    ms = (splitInt[0] * 60) + splitInt[1];
  } else if (split.length == 1) {
    ms = splitInt[0];
  }
  ms *= 1000;
  if (milli != null) {
    ms += milli;
  }
  return ms;
}

export function getTimestampValue(value: string): number {
  const split = value.split(":");
  const splitInt = [];
  if (split.length > 3 || split.length == 0) return null;
  for (let n = 0; n < split.length; n++) {
    if (n != 0) {
      if (split[n].length != 2) return null;
    }
    const int = parseInt(split[n]);
    if (isNaN(int)) return null;
    splitInt.push(int);
  }

  if (split.length == 3) {
    return (splitInt[0] * 60 * 60) + (splitInt[1] * 60) + splitInt[2];
  } else if (split.length == 2) {
    return (splitInt[0] * 60) + splitInt[1];
  } else if (split.length == 1) {
    return splitInt[0];
  }
}

export function generateThumbnailFile(cachePath: string, data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let checksumThumbnailPath = cachePath;
  if (!checksumThumbnailPath.endsWith("/")) {
    checksumThumbnailPath += "/";
  }
  checksumThumbnailPath += "thumbs/";
  const checksum = hashBytesSync(bytes);
  checksumThumbnailPath += checksum + ".png";
  writeThumbnailFile(checksumThumbnailPath, bytes);
  return checksumThumbnailPath;
}

function hashBytesSync(bytes: Uint8Array): string {
  let hash = 5381;
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) + hash) ^ bytes[i];
  }
  return (hash >>> 0).toString(16);
}

function writeThumbnailFile(path: string, bytes: Uint8Array) {
  const fs = getFilesystem();
  fs.fileExists(path).then((exists) => {
    if (!exists) {
      return fs.writeFile(path, bytes.slice().buffer as ArrayBuffer);
    }
    return null;
  }).then(() => {
    rememberPath(path);
  }).catch((e) => {
    console.error("Failed to write thumbnail", e);
  });
}

export function extractMusicMetadata(audio: Audio, metadata: any, cachePath: string) {
  if (metadata.common) {
    if (metadata.common.title) {
      audio.name = metadata.common.title;
    }
    if (metadata.common.album) {
      audio.album = metadata.common.album;
    }
    if (metadata.common.artist) {
      audio.artist = metadata.common.artist;
    }
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      audio.thumb = generateThumbnailFile(cachePath, picture.data ? new Uint8Array(picture.data) : new Uint8Array(0));
    }
    if (metadata.common.track && metadata.common.track.no) {
      audio.trackNum = parseInt(metadata.common.track.no);
    }
    if (metadata.common.bpm) {
      audio.bpm = parseFloat(metadata.common.bpm);
    }
  }
  if (metadata.format && metadata.format.duration) {
    audio.duration = metadata.format.duration;
  } else if (!isCapacitor()) {
    // Only decode the full file for its duration when it is small enough to
    // buffer safely across the native bridge. Large WAVs (GBs) would OOM the
    // app; their duration is reported by the native audio player instead.
    const fs = getFilesystem();
    fs.stat(audio.url).then((st) => {
      if (st.size <= MAX_DURATION_DECODE_BYTES) {
        fs.readFile(audio.url).then((data) => {
          let context = new AudioContext();
          context.decodeAudioData(data, (buffer) => {
            audio.duration = buffer.duration;
          });
        }).catch((e) => {
          console.error("Failed to decode audio duration", e);
        });
      }
    }).catch((e) => {
      console.error("Failed to stat audio file for duration", e);
    });
  }
}

export function getLocalPath(source: string, config: Config) {
  return cachePath(source, "local", config);
}

export function getCachePath(source: string, config: Config) {
  const typeDir = en.get(getSourceType(source)).toLowerCase();
  return cachePath(source, typeDir, config);
}

function cachePath(source: string, typeDir: string, config: Config) {
  if (config.caching.directory != "") {
    let baseDir = config.caching.directory;
    if (!baseDir.endsWith(path.sep)) {
      baseDir += path.sep;
    }
    if (source) {
      if (source != ST.video && source != ST.playlist) {
        return baseDir + typeDir + path.sep + getFileGroup(source) + path.sep;
      } else {
        return baseDir + typeDir + path.sep;
      }
    } else {
      return baseDir;
    }
  } else {
    if (source) {
      if (source != ST.video && source != ST.playlist) {
        return saveDir + path.sep + "ImageCache" + path.sep + typeDir + path.sep + getFileGroup(source) + path.sep;
      } else {
        return saveDir + path.sep + "ImageCache" + path.sep + typeDir + path.sep;
      }
    } else {
      return saveDir + path.sep + "ImageCache" + path.sep;
    }
  }
}

export function htmlEntities(str: string): string {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\\n/g,"<br/>");
}

export function urlToPath(url: string): string {
  return decodeURIComponent(new URL(url).pathname);
}

export function removeDuplicatesBy(keyFn: Function, array: any[]): any[] {
  let mySet = new Set();
  return array.filter(function (x: any) {
    let key = keyFn(x);
    let isNew = !mySet.has(key);
    if (isNew) mySet.add(key);
    return isNew;
  });
}

export function arrayMove(arr: any[], old_index: number, new_index: number) {
  if (new_index >= arr.length) {
    let k = new_index - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
}

export function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const buffer = data.buffer;
  if (buffer.byteLength == data.byteLength && data.byteOffset == 0) return buffer as ArrayBuffer;
  return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export function getRandomColor() {
  let letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

export function randomizeList(list: any[]) {
  let currentIndex = list.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = list[currentIndex];
    list[currentIndex] = list[randomIndex];
    list[randomIndex] = temporaryValue;
  }

  return list;
}

export function getRandomIndex(list: any[]) {
  return Math.floor(Math.random() * list.length)
}

export function getRandomNumber(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function getRandomListItem(list: any[], count: number = 1) {
  if (count <= 0) {
    return;
  } else if (count == 1) {
    return list[getRandomIndex(list)];
  } else {
    let newList = [];
    for (let c = 0; c < count && list.length > 0; c++) {
      newList.push(list.splice(getRandomIndex(list), 1)[0])
    }
    return newList;
  }
}

export async function getFilesRecursively(dir: string): Promise<string[]> {
  const fs = getFilesystem();
  const result: string[] = [];
  const walk = async (current: string) => {
    let entries;
    try {
      entries = await fs.readDirectory(current);
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        await walk(entry.path);
      } else {
        result.push(entry.path);
      }
    }
  };
  await walk(dir);
  return result;
}

export function isText(path: string, strict: boolean): boolean {
  if (path == null) return false;
  const p = path.toLowerCase();
  const acceptableExtensions = [".txt"];
  for (let ext of acceptableExtensions) {
    if (strict) {
      if (p.endsWith(ext)) return true;
    } else {
      if (p.includes(ext)) return true;
    }
  }
  return false;
}

function areRulesValid(wg: WeightGroup) {
  const orRules = wg.rules.filter((r) => r.type == TT.or);
  const weightRules = wg.rules.filter((r) => r.type == TT.weight);
  let rulesRemaining = 100;
  for (let rule of weightRules) {
    rulesRemaining = rulesRemaining - rule.percent;
  }
  return wg.rules.length > 0 && (orRules.length == 0 || (orRules.length + weightRules.length == wg.rules.length && rulesRemaining == 0) || orRules.length == wg.rules.length) && (rulesRemaining == 0 || (rulesRemaining == 100 && weightRules.length == 0));
}

export function areWeightsValid(scene: Scene): boolean {
  if (!scene.generatorWeights) return false;
  let remaining = 100;
  const orRules = scene.generatorWeights.filter((r) => r.type == TT.or);
  const weightRules = scene.generatorWeights.filter((r) => r.type == TT.weight);
  for (let wg of scene.generatorWeights) {
    if (wg.rules) {
      const rulesValid = areRulesValid(wg);
      if (!rulesValid) return false;
    }
    if (wg.type == TT.weight) {
      remaining = remaining - wg.percent;
    }
  }
  return scene.generatorWeights.length > 0 && (orRules.length == 0 || (orRules.length + weightRules.length == scene.generatorWeights.length && remaining == 0) || orRules.length == scene.generatorWeights.length) && (remaining == 0 || (remaining == 100 && weightRules.length == 0));
}

const _regexCache = new Map<string, RegExp>();

const COUNT_REGEX = /^count(\+?)([>=<])(\d*)$/;
const DURATION_REGEX = /^duration([>=<])([\d:]*)$/;
const RESOLUTION_REGEX = /^resolution([>=<])(\d*)p?$/;

function _getCachedRegex(pattern: string, flags: string): RegExp {
  const key = flags + ":" + pattern;
  let regex = _regexCache.get(key);
  if (!regex) {
    regex = new RegExp(pattern, flags);
    _regexCache.set(key, regex);
  }
  return regex;
}

export function filterSource(filter: string, source: LibrarySource, clip: Clip, mergeSources?: Array<LibrarySource>): boolean {
  let matchesFilter = true;
  let countRegex;
  if (filter == "<Mergeable>") {
    matchesFilter = !!mergeSources && mergeSources.includes(source);
  } else if (filter == "-<Mergeable>") {
    matchesFilter = !(!!mergeSources && mergeSources.includes(source));
  } else if (filter == "<Offline>") { // This is offline filter
    matchesFilter = source.offline;
  } else if (filter == "-<Offline>") { // This is offline filter
    matchesFilter = !(source.offline);
  } else if (filter == "<Marked>") { // This is a marked filter
    matchesFilter = source.marked;
  } else if (filter == "-<Marked>") { // This is a marked filter
    matchesFilter = !(source.marked);
  } else if (filter == "<Untagged>") { // This is untagged filter
    matchesFilter = clip && clip.tags && clip.tags.length > 0 ? clip.tags.length === 0 : source.tags.length === 0;
  } else if (filter == "-<Untagged>") { // This is untagged filter
    matchesFilter = !(clip && clip.tags && clip.tags.length > 0 ? clip.tags.length === 0 : source.tags.length === 0);
  } else if (filter == "<Unclipped>") {
    matchesFilter = getSourceType(source.url) == ST.video && source.clips.length === 0;
  } else if (filter == "-<Unclipped>") {
    matchesFilter = !(getSourceType(source.url) == ST.video && source.clips.length === 0);
  } else if ((filter.startsWith("[") || filter.startsWith("-[")) && filter.endsWith("]")) { // This is a tag filter
    let tags = clip && clip.tags && clip.tags.length > 0 ? clip.tags : source.tags;
    if (filter.startsWith("-")) {
      let tag = filter.substring(2, filter.length-1);
      matchesFilter = tags.find((t) => t.name == tag) == null;
    } else {
      let tag = filter.substring(1, filter.length-1);
      matchesFilter = tags.find((t) => t.name == tag) != null;
    }
  } else if ((filter.startsWith("{") || filter.startsWith("-{")) && filter.endsWith("}")) { // This is a type filter
    if (filter.startsWith("-")) {
      let type = filter.substring(2, filter.length-1);
      matchesFilter = en.get(getSourceType(source.url)) != type;
    } else {
      let type = filter.substring(1, filter.length-1);
      matchesFilter = en.get(getSourceType(source.url)) == type;
    }
  } else if ((countRegex = COUNT_REGEX.exec(filter)) != null) {
    const all = countRegex[1] == "+";
    const symbol = countRegex[2];
    const value = parseInt(countRegex[3]);
    const type = getSourceType(source.url);
    const count = type == ST.video ? source.clips.length : source.count;
    const countComplete = type == ST.video ? true : source.countComplete;
    switch (symbol) {
      case "=":
        matchesFilter = (all || countComplete) && count == value;
        break;
      case ">":
        matchesFilter = (all || countComplete) && count > value;
        break;
      case "<":
        matchesFilter = (all || countComplete) && count < value;
        break;
    }
  } else if ((countRegex = DURATION_REGEX.exec(filter)) != null) {
    const symbol = countRegex[1];
    let value;
    if (countRegex[2].includes(":")) {
      value = getTimestampValue(countRegex[2]);
    } else {
      value = parseInt(countRegex[2]);
    }
    const type = getSourceType(source.url);
    if (type == ST.video) {
      let duration = clip ? clip.end - clip.start : source.duration;
      if (duration == null) {
        matchesFilter = false;
      } else {
        switch (symbol) {
          case "=":
            matchesFilter = Math.floor(duration) == value;
            break;
          case ">":
            matchesFilter = Math.floor(duration) > value;
            break;
          case "<":
            matchesFilter = Math.floor(duration) < value;
            break;
        }
      }
    } else {
      matchesFilter = false;
    }
  } else if ((countRegex = RESOLUTION_REGEX.exec(filter)) != null) {
    const symbol = countRegex[1];
    const value = parseInt(countRegex[2]);

    const type = getSourceType(source.url);
    if (type == ST.video) {
      if (source.resolution == null) {
        matchesFilter = false;
      } else {
        switch (symbol) {
          case "=":
            matchesFilter = source.resolution == value;
            break;
          case ">":
            matchesFilter = source.resolution > value;
            break;
          case "<":
            matchesFilter = source.resolution < value;
            break;
        }
      }
    } else {
      matchesFilter = false;
    }
  } else if (((filter.startsWith('"') || filter.startsWith('-"')) && filter.endsWith('"')) ||
    ((filter.startsWith('\'') || filter.startsWith('-\'')) && filter.endsWith('\''))) {
    if (filter.startsWith("-")) {
      filter = filter.substring(2, filter.length - 1);
      matchesFilter = !_getCachedRegex(filter.replace("\\", "\\\\"), "i").test(source.url);
    } else {
      filter = filter.substring(1, filter.length - 1);
      matchesFilter = _getCachedRegex(filter.replace("\\", "\\\\"), "i").test(source.url);
    }
  } else { // This is a search filter
    filter = filter.replace("\\", "\\\\");
    if (filter.startsWith("-")) {
      filter = filter.substring(1, filter.length);
      matchesFilter = !_getCachedRegex(filter.replace("\\", "\\\\"), "i").test(source.url);
    } else {
      matchesFilter = _getCachedRegex(filter.replace("\\", "\\\\"), "i").test(source.url);
    }
  }
  return matchesFilter;
}

const EFFECT_KEYS = [
  'timingFunction', 'timingConstant', 'timingMin', 'timingMax', 'timingSinRate', 'timingBPMMulti',
  'backForth', 'backForthTF', 'backForthConstant', 'backForthMin', 'backForthMax', 'backForthSinRate', 'backForthBPMMulti',
  'imageType', 'backgroundType', 'backgroundColor', 'backgroundColorSet', 'backgroundBlur',
  'imageTypeFilter', 'fullSource', 'imageOrientation', 'gifOption',
  'gifTimingConstant', 'gifTimingMin', 'gifTimingMax',
  'videoOrientation', 'videoOption', 'videoTimingConstant', 'videoTimingMin', 'videoTimingMax',
  'videoSpeed', 'videoRandomSpeed', 'videoSpeedMin', 'videoSpeedMax',
  'randomVideoStart', 'continueVideo', 'playVideoClips', 'skipVideoStart', 'skipVideoEnd', 'videoVolume',
  'weightFunction', 'sourceOrderFunction', 'forceAllSource', 'orderFunction', 'forceAll',
  'zoom', 'zoomRandom', 'zoomStart', 'zoomStartMin', 'zoomStartMax', 'zoomEnd', 'zoomEndMin', 'zoomEndMax',
  'horizTransType', 'horizTransLevel', 'horizTransLevelMin', 'horizTransLevelMax', 'horizTransRandom',
  'vertTransType', 'vertTransLevel', 'vertTransLevelMin', 'vertTransLevelMax', 'vertTransRandom',
  'transTF', 'transDuration', 'transDurationMin', 'transDurationMax', 'transSinRate', 'transBPMMulti',
  'transEase', 'transExp', 'transAmp', 'transPer', 'transOv',
  'crossFade', 'crossFadeAudio',
  'fadeTF', 'fadeDuration', 'fadeDurationMin', 'fadeDurationMax', 'fadeSinRate', 'fadeBPMMulti',
  'fadeEase', 'fadeExp', 'fadeAmp', 'fadePer', 'fadeOv',
  'slide', 'slideTF', 'slideType', 'slideDistance', 'slideDuration', 'slideDurationMin', 'slideDurationMax',
  'slideSinRate', 'slideBPMMulti', 'slideEase', 'slideExp', 'slideAmp', 'slidePer', 'slideOv',
  'strobe', 'strobePulse', 'strobeLayer', 'strobeOpacity',
  'strobeTF', 'strobeTime', 'strobeTimeMin', 'strobeTimeMax', 'strobeSinRate', 'strobeBPMMulti',
  'strobeDelayTF', 'strobeDelay', 'strobeDelayMin', 'strobeDelayMax', 'strobeDelaySinRate', 'strobeDelayBPMMulti',
  'strobeColorType', 'strobeColor', 'strobeColorSet', 'strobeEase', 'strobeExp', 'strobeAmp', 'strobePer', 'strobeOv',
  'fadeInOut', 'fadeIOPulse', 'fadeIOTF', 'fadeIODuration', 'fadeIODurationMin', 'fadeIODurationMax',
  'fadeIOSinRate', 'fadeIOBPMMulti', 'fadeIODelayTF', 'fadeIODelay', 'fadeIODelayMin', 'fadeIODelayMax',
  'fadeIODelaySinRate', 'fadeIODelayBPMMulti', 'fadeIOStartEase', 'fadeIOStartExp', 'fadeIOStartAmp',
  'fadeIOStartPer', 'fadeIOStartOv', 'fadeIOEndEase', 'fadeIOEndExp', 'fadeIOEndAmp', 'fadeIOEndPer', 'fadeIOEndOv',
  'panning', 'panTF', 'panDuration', 'panDurationMin', 'panDurationMax', 'panSinRate', 'panBPMMulti',
  'panHorizTransType', 'panHorizTransImg', 'panHorizTransLevel', 'panHorizTransLevelMax', 'panHorizTransLevelMin', 'panHorizTransRandom',
  'panVertTransType', 'panVertTransImg', 'panVertTransLevel', 'panVertTransLevelMax', 'panVertTransLevelMin', 'panVertTransRandom',
  'panStartEase', 'panStartExp', 'panStartAmp', 'panStartPer', 'panStartOv',
  'panEndEase', 'panEndExp', 'panEndAmp', 'panEndPer', 'panEndOv',
] as const;

export function getEffects(scene: Scene): string {
  const effects: any = {};
  for (const key of EFFECT_KEYS) {
    effects[key] = (scene as any)[key];
  }
  return JSON.stringify(effects);
}

export function applyEffects(scene: Scene, effectsJSON: string): Scene {
  const effects = JSON.parse(effectsJSON);
  for (const key of EFFECT_KEYS) {
    if (key in effects) {
      (scene as any)[key] = effects[key];
    }
  }
  return scene;
}

let captionProgramDefaults = {
  program: Array<Function>(),
  programCounter: 0,
  timestamps: Array<number>(),
  timestampFn: new Map<number, Array<Function>>(),
  timestampCounter: 0,
  audios: new Array<{alias: string, file: string, playing: boolean, volume: number}>(),
  phrases: new Map<number, Array<string>>(),

  blinkDuration: [200, 500],
  blinkWaveRate: 100,
  blinkBPMMulti: 1,
  blinkTF: TF.constant,

  blinkDelay: [80, 200],
  blinkDelayWaveRate: 100,
  blinkDelayBPMMulti: 1,
  blinkDelayTF: TF.constant,

  blinkGroupDelay: [1200, 2000],
  blinkGroupDelayWaveRate: 100,
  blinkGroupDelayBPMMulti: 1,
  blinkGroupDelayTF: TF.constant,

  captionDuration: [2000, 4000],
  captionWaveRate: 100,
  captionBPMMulti: 1,
  captionTF: TF.constant,

  captionDelay: [1200, 2000],
  captionDelayWaveRate: 100,
  captionDelayBPMMulti: 1,
  captionDelayTF: TF.constant,

  countDuration: [600, 1000],
  countWaveRate: 100,
  countBPMMulti: 1,
  countTF: TF.constant,

  countDelay: [400, 1000],
  countDelayWaveRate: 100,
  countDelayBPMMulti: 1,
  countDelayTF: TF.constant,

  showCountProgress: false,
  countProgressOffset: false,
  countColorMatch: false,
  countProgressScale: 500,

  countGroupDelay: [1200, 2000],
  countGroupDelayWaveRate: 100,
  countGroupDelayBPMMulti: 1,
  countGroupDelayTF: TF.constant,

  blinkY: 0,
  captionY: 0,
  bigCaptionY: 0,
  countY: 0,

  blinkX: 0,
  captionX: 0,
  bigCaptionX: 0,
  countX: 0,

  blinkOpacity: 100,
  captionOpacity: 100,
  countOpacity: 100,
}
export default captionProgramDefaults;

// Inspired by https://reactjs.org/blog/2015/12/16/ismounted-antipattern.html
/**
 * This object is a custom Promise wrapper which enables the ability to cancel the promise.
 *
 * In order to assist with processing the next promise, this promise returns a list of strings as well as a
 * helper object used to build the next promise. This helper object can have the follow values:
 *   * next - null or a value to use in the follow-up promise
 *   * count - current count
 */
export class CancelablePromise extends Promise<{
  data: Array<string>, helpers: {next: any, count: number, retries: number, uuid: string}}> {
  hasCanceled: boolean;
  source: LibrarySource;
  timeout: number;


  constructor(executor: (resolve: (value?: (
    PromiseLike<{data: Array<string>, helpers: {next: any, count: number, retries: number, uuid: string}}> |
    {data: Array<string>, helpers: {next: any, count: number, retries: number, uuid: string}}
    )) => void, reject: (reason?: any) => void) => void) {
    super(executor);
    this.hasCanceled = false;
    this.source = null;
    this.timeout = 0;
  }

  getPromise(): Promise<{data: Array<string>, helpers: {next: any, count: number, retries: number, uuid: string}}> {
    return new Promise((resolve, reject) => {
      this.then(
        val => this.hasCanceled ? null : resolve(val),
        error => this.hasCanceled ? null : reject(error)
      );
    });
  }

  cancel() {
    this.hasCanceled = true;
  }
}

/**
 * Hard-abbreviates a display name for compact list rows. Keeps only the first
 * `max` characters and appends an ellipsis; the full name stays available via
 * the row's title tooltip. File extensions are intentionally dropped.
 */
export function abbreviateName(name: string, max = 10): string {
  if (name == null) return name;
  if (name.length <= max) return name;
  return name.slice(0, Math.max(1, max - 1)) + "…";
}