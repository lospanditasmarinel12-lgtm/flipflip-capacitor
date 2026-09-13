import { immerable } from "immer";

export default class Playlist {
  [immerable] = true;

  id: number = 0;
  name: string;
  audios: Array<number> = []; // Array of audio IDs

  constructor(init?: Partial<Playlist>) {
    Object.assign(this, init);
  }
}