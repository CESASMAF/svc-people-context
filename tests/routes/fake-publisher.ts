import type { EventPublisher } from "../../src/events/publisher.ts";

export const createFakePublisher = (): EventPublisher & {
  readonly published: { subject: string; payload: unknown }[];
} => {
  const published: { subject: string; payload: unknown }[] = [];
  return {
    published,
    publish: async (event) => {
      published.push({ subject: event.subject, payload: event.payload });
    },
    close: async () => {},
  };
};
