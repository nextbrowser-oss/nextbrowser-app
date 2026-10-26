/** A step that cannot run here: a missing account, agent, proxy or service. */
export class Blocked extends Error {}

export function blocked(reason) {
  throw new Blocked(reason);
}
