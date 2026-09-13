import { immerable } from "immer";

export default class SceneGroup {
  [immerable] = true;

  id: number = 0;
  type: string;
  name: string = "New Group";
  scenes: Array<number> = [];

  constructor(init?: Partial<SceneGroup>) {
    Object.assign(this, init);
  }
}