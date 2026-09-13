import { immerable } from "immer";

export default class WeightGroup {
  [immerable] = true;

  percent: number;
  type: string;
  search: string;
  max: number;
  chosen: number;
  rules: Array<WeightGroup>;

  constructor(init?: Partial<WeightGroup>) {
    Object.assign(this, init);
  }
}