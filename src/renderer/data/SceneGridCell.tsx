import { immerable } from "immer";

export default class SceneGridCell {
  [immerable] = true;

  sceneID: number = -1;
  sceneCopy: Array<number> = [];
  mirror = false;

  constructor(init?: Partial<SceneGridCell>) {
    Object.assign(this, init);
  }
}