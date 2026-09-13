import { immerable } from "immer";

export default class Overlay {
  [immerable] = true;

  id: number = 0;
  sceneID: number = 0;
  opacity: number = 50;

  constructor(init?: Partial<Overlay>) {
    Object.assign(this, init);
  }
}