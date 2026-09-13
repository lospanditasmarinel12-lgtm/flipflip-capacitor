import { immerable } from "immer";

export default class Tag {
  [immerable] = true;

  id: number = 0;
  name: string;
  phraseString: string;

  constructor(init?: Partial<Tag>) {
    Object.assign(this, init);
  }
}